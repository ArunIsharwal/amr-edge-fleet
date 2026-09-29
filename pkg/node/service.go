package node

import (
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"time"

	connect "connectrpc.com/connect"

	v1 "sih-amr-fleet/pkg/proto/fleet/v1"
	"sih-amr-fleet/pkg/proto/fleet/v1/fleetv1connect"
)

type FleetServiceServer struct {
	fleetv1connect.UnimplementedFleetServiceHandler
	node *RobotNode
}

func NewFleetServiceServer(node *RobotNode) *FleetServiceServer {
	return &FleetServiceServer{
		node: node,
	}
}

// StreamP2PMesh implements bi-directional 10Hz inter-robot P2P sync over ConnectRPC / HTTP3 QUIC
func (s *FleetServiceServer) StreamP2PMesh(
	ctx context.Context,
	stream *connect.BidiStream[v1.SyncPayload, v1.SyncResponsePayload],
) error {
	for {
		req, err := stream.Receive()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		senderProto := req.GetSender()
		if senderProto == nil {
			continue
		}

		sender := RobotStateFromProto(senderProto)

		snap, yieldAck, processErr := func() (RobotState, bool, error) {
			s.node.mu.Lock()
			defer s.node.mu.Unlock()

			s.node.PeerLastSeen[sender.RobotID] = time.Now().UnixMilli()
			s.node.PeerStates[sender.RobotID] = sender

			// If peer is stationary / idle / offline, update idle peer lock
			if sender.Status == "IDLE" || !sender.IsOnline || sender.Status == "OFFLINE_SIMULATED" {
				s.node.ReservationTable.UpdateIdlePeer(sender.RobotID, Point{
					X: sender.CurrentPos.X,
					Y: sender.CurrentPos.Y,
				})
			} else {
				s.node.ReservationTable.RemoveIdlePeer(sender.RobotID)

				// Synchronize space-time path reservations calibrated to 300ms step travel time
				nowMs := time.Now().UnixMilli()
				// Lock sender's current position immediately
				s.node.ReservationTable.AddReservation(ReservedCell{
					X:        sender.CurrentPos.X,
					Y:        sender.CurrentPos.Y,
					RobotID:  sender.RobotID,
					Priority: sender.PriorityScore,
					Window:   TimeWindow{StartTimeMs: nowMs - 100, EndTimeMs: nowMs + 300},
				})
				for idx, pt := range sender.Path {
					s.node.ReservationTable.AddReservation(ReservedCell{
						X:        pt.X,
						Y:        pt.Y,
						RobotID:  sender.RobotID,
						Priority: sender.PriorityScore,
						Window: TimeWindow{
							StartTimeMs: nowMs + int64(idx*300),
							EndTimeMs:   nowMs + int64((idx+1)*300) + 100,
						},
					})
				}
			}

			distIntended := math.Hypot(s.node.IntendedX-sender.IntendedPos.X, s.node.IntendedY-sender.IntendedPos.Y)
			distCurrent := math.Hypot(s.node.CurrentX-sender.CurrentPos.X, s.node.CurrentY-sender.CurrentPos.Y)

			localYieldAck := false

			// ── 0.8m proximity collision check with distance-to-goal priority tiebreaking ────────
			if (distIntended < 0.8 || distCurrent < 0.8) && s.node.Status != "IDLE" && sender.Status != "IDLE" {
				shouldYield := s.node.shouldYieldToPeer(sender.RobotID, sender.PriorityScore, sender.CurrentPos, sender.TargetPos)

				if shouldYield && s.node.Status != "YIELDING" && s.node.YieldCooldownTicks == 0 {
					s.node.Status = "YIELDING"
					s.node.IsYielding = true
					s.node.YieldTicksLeft = 8 // 8 × 100ms = 800ms
					s.node.Path = make([]Point, 0)
					s.node.PathIdx = 0
					localYieldAck = true
					s.node.Metrics.RecordCollision()
					s.node.ReservationTable.UpdateIdlePeer(s.node.ID, Point{X: s.node.CurrentX, Y: s.node.CurrentY})
					log.Printf("🛑 [%s] YIELDING via ConnectRPC stream (dist=%.2fm)", s.node.ID, distCurrent)
				}
			} else if s.node.Status == "YIELDING" && distCurrent > 1.2 {
				s.node.Status = "NAVIGATING_PICKUP"
				if s.node.CurrentTask != nil && s.node.CurrentTask.Status == "DELIVERING" {
					s.node.Status = "DELIVERING"
				}
				s.node.IsYielding = false
				s.node.YieldTicksLeft = 0
				s.node.Path = make([]Point, 0)
				s.node.PathIdx = 0
			}

			// ── Path-conflict detection: peer is blocking THIS robot's planned path ──
			if s.node.Status != "YIELDING" && sender.IsOnline && sender.Status != "OFFLINE_SIMULATED" {
				for idx := s.node.PathIdx; idx < len(s.node.Path); idx++ {
					if math.Hypot(s.node.Path[idx].X-sender.CurrentPos.X, s.node.Path[idx].Y-sender.CurrentPos.Y) < 0.8 {
						shouldReroute := s.node.shouldYieldToPeer(sender.RobotID, sender.PriorityScore, sender.CurrentPos, sender.TargetPos)
						if shouldReroute && len(s.node.Path) > 0 {
							log.Printf("🔄 [%s] PATH-CONFLICT via stream: %s blocks path[%d] → REPLANNING",
								s.node.ID, sender.RobotID, idx)
							s.node.Path = make([]Point, 0)
							s.node.PathIdx = 0
							s.node.Status = "REPLANNING"
						}
						break
					}
				}
			}

			return s.node.getSnapshotLocked(), localYieldAck, nil
		}()

		if processErr != nil {
			return processErr
		}

		resp := &v1.SyncResponsePayload{
			Receiver:          RobotStateToProto(snap),
			YieldAcknowledged: yieldAck,
		}

		if err := stream.Send(resp); err != nil {
			return err
		}
	}
}

// StreamFleetTelemetry implements 10Hz Server Streaming RPC for React Dashboard
func (s *FleetServiceServer) StreamFleetTelemetry(
	ctx context.Context,
	req *connect.Request[v1.FleetTelemetryRequest],
	stream *connect.ServerStream[v1.FleetTelemetry],
) error {
	ticker := time.NewTicker(100 * time.Millisecond) // 10Hz push stream to dashboard
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("StreamFleetTelemetry context done: %v", ctx.Err())
			return nil
		case <-ticker.C:
			telemetry := s.buildFleetTelemetry()
			if err := stream.Send(telemetry); err != nil {
				log.Printf("StreamFleetTelemetry stream.Send error: %v", err)
				return err
			}
		}
	}
}

func (s *FleetServiceServer) handleDashboardCommand(cmd *v1.DashboardCommand) {
	if cmd == nil {
		return
	}

	switch cmd.GetCommandType() {
	case "DISPATCH_TASK":
		if tProto := cmd.GetTask(); tProto != nil {
			task := TaskFromProto(tProto)
			if task != nil {
				s.node.AssignTask(*task)
				s.node.TaskManager.AddOrUpdateTask(*task)
				log.Printf("🚀 [%s] Task Dispatched via ConnectRPC Stream: %s", s.node.ID, task.ID)
			}
		}
	case "BLOCK_AISLE":
		bx, by := cmd.GetBlockX(), cmd.GetBlockY()
		s.node.mu.Lock()
		s.node.ReservationTable.SetAisleBlocked(bx, by, true)
		s.node.Status = "REPLANNING"
		s.node.Path = make([]Point, 0)
		s.node.mu.Unlock()
		log.Printf("⚠️  [%s] Blocked Aisle via ConnectRPC Stream at (%.1f, %.1f)", s.node.ID, bx, by)
	case "CLEAR_AISLES":
		s.node.mu.Lock()
		s.node.ReservationTable.blockedAisles = make(map[string]bool)
		s.node.mu.Unlock()
		log.Printf("✅ [%s] Cleared Aisle Faults via ConnectRPC Stream", s.node.ID)
	case "TOGGLE_POWER":
		s.node.mu.Lock()
		s.node.IsOnline = cmd.GetEnable()
		if !s.node.IsOnline {
			s.node.Status = "OFFLINE_SIMULATED"
			s.node.Path = make([]Point, 0)
			s.node.PathIdx = 0
			s.node.ReservationTable.UpdateIdlePeer(s.node.ID, Point{X: s.node.CurrentX, Y: s.node.CurrentY})
			log.Printf("🛑 [%s] Node DISABLED via ConnectRPC — frozen at (%.1f, %.1f)", s.node.ID, s.node.CurrentX, s.node.CurrentY)
		} else {
			s.node.Status = "IDLE"
			s.node.Battery = 98.0
			s.node.Path = make([]Point, 0)
			s.node.PathIdx = 0
			s.node.ReservationTable.RemoveIdlePeer(s.node.ID)
			log.Printf("⚡ [%s] Node RECOVERED via ConnectRPC", s.node.ID)
		}
		s.node.mu.Unlock()
	case "SET_MODE":
		s.node.Metrics.SetMode(cmd.GetMode())
	}
}

func (s *FleetServiceServer) buildFleetTelemetry() *v1.FleetTelemetry {
	s.node.mu.RLock()
	defer s.node.mu.RUnlock()

	robotsMap := make(map[string]*v1.RobotState)
	mySnap := RobotStateToProto(s.node.getSnapshotLocked())
	robotsMap[s.node.ID] = mySnap

	for id, peerState := range s.node.PeerStates {
		robotsMap[id] = RobotStateToProto(peerState)
	}

	tasks := s.node.TaskManager.GetAllTasks()
	tasksProto := make([]*v1.Task, len(tasks))
	for i, t := range tasks {
		tasksProto[i] = TaskToProto(&t)
	}

	s.node.Metrics.mu.RLock()
	collisions := s.node.Metrics.CollisionCount
	mode := s.node.Metrics.CurrentMode
	s.node.Metrics.mu.RUnlock()

	return &v1.FleetTelemetry{
		Robots:               robotsMap,
		Tasks:                tasksProto,
		PotentialCollisions: int32(collisions),
		TotalTasksCompleted: int32(s.node.TasksCompleted),
		Mode:                 mode,
	}
}

func (s *FleetServiceServer) AssignTask(
	ctx context.Context,
	req *connect.Request[v1.AssignTaskRequest],
) (*connect.Response[v1.AssignTaskResponse], error) {
	t := TaskFromProto(req.Msg.GetTask())
	if t == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("task is required"))
	}
	if t.ID == "" {
		t.ID = fmt.Sprintf("TASK-%d", time.Now().UnixMilli()%10000)
	}

	// Explicit Target Robot ID Verification
	if t.AssignedTo != "" && t.AssignedTo != s.node.ID {
		s.node.TaskManager.AddOrUpdateTask(*t)
		log.Printf("ℹ️  [%s] Task %s is assigned to %s (recording task in task manager)", s.node.ID, t.ID, t.AssignedTo)
	} else {
		t.AssignedTo = s.node.ID
		s.node.AssignTask(*t)
		s.node.TaskManager.AddOrUpdateTask(*t)
		log.Printf("🚀 [%s] Task %s accepted and assigned to self", s.node.ID, t.ID)
	}

	res := &v1.AssignTaskResponse{
		Status:  "ok",
		RobotId: s.node.ID,
		Task:    TaskToProto(t),
	}
	return connect.NewResponse(res), nil
}

func (s *FleetServiceServer) ToggleNode(
	ctx context.Context,
	req *connect.Request[v1.ToggleNodeRequest],
) (*connect.Response[v1.ToggleNodeResponse], error) {
	msg := req.Msg
	s.node.mu.Lock()
	if msg.GetBlockAisle() {
		s.node.ReservationTable.SetAisleBlocked(msg.GetBlockedX(), msg.GetBlockedY(), true)
		s.node.Status = "REPLANNING"
		s.node.Path = make([]Point, 0)
	} else {
		s.node.IsOnline = msg.GetEnable()
		if !s.node.IsOnline {
			s.node.Status = "OFFLINE_SIMULATED"
			s.node.ReservationTable.UpdateIdlePeer(s.node.ID, Point{X: s.node.CurrentX, Y: s.node.CurrentY})
		} else {
			s.node.Status = "IDLE"
			s.node.Battery = 98.0
			s.node.Path = make([]Point, 0)
		}
	}
	if msg.GetMode() != "" {
		s.node.Metrics.SetMode(msg.GetMode())
	}
	s.node.mu.Unlock()

	return connect.NewResponse(&v1.ToggleNodeResponse{Status: "ok"}), nil
}
