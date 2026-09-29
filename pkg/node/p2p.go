package node

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/quic-go/quic-go/http3"
)

type SyncPayload struct {
	Sender RobotState `json:"sender"`
}

type SyncResponsePayload struct {
	Receiver          RobotState `json:"receiver"`
	YieldAcknowledged bool       `json:"yield_acknowledged"`
}

type TogglePayload struct {
	RobotID    string  `json:"robot_id"`
	Enable     bool    `json:"enable"`
	BlockAisle bool    `json:"block_aisle"`
	BlockedX   float64 `json:"blocked_x"`
	BlockedY   float64 `json:"blocked_y"`
	Mode       string  `json:"mode"`
}

type TaskAssignPayload struct {
	Task Task `json:"task"`
}

func (r *RobotNode) HandleAssignTask(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload TaskAssignPayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	task := payload.Task
	if task.ID == "" {
		task.ID = fmt.Sprintf("TASK-%d", time.Now().UnixMilli()%10000)
	}
	if task.Priority == 0 {
		task.Priority = 50
	}

	r.AssignTask(task)
	r.TaskManager.AddOrUpdateTask(task)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ok",
		"robot_id": r.ID,
		"task":     task,
	})
}

func (r *RobotNode) HandleGetTasks(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	tasks := r.TaskManager.GetAllTasks()
	json.NewEncoder(w).Encode(tasks)
}

// isOnMyPath returns true if the given point is within 1.0m of any waypoint
// on this robot's current planned path. Called while holding r.mu.
func (r *RobotNode) isOnMyPath(px, py float64) bool {
	for idx := r.PathIdx; idx < len(r.Path); idx++ {
		if math.Hypot(r.Path[idx].X-px, r.Path[idx].Y-py) < 1.0 {
			return true
		}
	}
	return false
}

// HandleSyncState receives a 10Hz peer broadcast over HTTP/3 QUIC.
// On receipt it:
//  1. Updates PeerStates & reservation table
//  2. Checks proximity — yields if needed
//  3. Checks if peer is blocking this robot's current planned path → force replan
func (r *RobotNode) HandleSyncState(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload SyncPayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sender := payload.Sender

	snap, yieldAck := func() (RobotState, bool) {
		r.mu.Lock()
		defer r.mu.Unlock()

		r.PeerLastSeen[sender.RobotID] = time.Now().UnixMilli()
		r.PeerStates[sender.RobotID] = sender

		// Register sender's space-time trajectory in this robot's reservation table
		if sender.Status == "IDLE" || !sender.IsOnline || sender.Status == "OFFLINE_SIMULATED" {
			r.ReservationTable.UpdateIdlePeer(sender.RobotID, Point{
				X: sender.CurrentPos.X,
				Y: sender.CurrentPos.Y,
			})
		} else {
			r.ReservationTable.RemoveIdlePeer(sender.RobotID)

			// Lock every waypoint on sender's path calibrated to 300ms per cell step
			nowMs := time.Now().UnixMilli()
			for idx, pt := range sender.Path {
				r.ReservationTable.AddReservation(ReservedCell{
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
			// Also lock sender's CURRENT position immediately
			r.ReservationTable.AddReservation(ReservedCell{
				X:        sender.CurrentPos.X,
				Y:        sender.CurrentPos.Y,
				RobotID:  sender.RobotID,
				Priority: sender.PriorityScore,
				Window: TimeWindow{
					StartTimeMs: nowMs - 100,
					EndTimeMs:   nowMs + 300,
				},
			})
		}

		distIntended := math.Hypot(r.IntendedX-sender.IntendedPos.X, r.IntendedY-sender.IntendedPos.Y)
		distCurrent := math.Hypot(r.CurrentX-sender.CurrentPos.X, r.CurrentY-sender.CurrentPos.Y)

		localYieldAck := false

		// ── Proximity conflict zone: 0.8m physical clearance check ──────────────
		if (distIntended < 0.8 || distCurrent < 0.8) && r.Status != "IDLE" && sender.Status != "IDLE" {
			shouldYield := r.shouldYieldToPeer(sender.RobotID, sender.PriorityScore, sender.CurrentPos, sender.TargetPos)

			if shouldYield && r.Status != "YIELDING" && r.YieldCooldownTicks == 0 {
				r.Status = "YIELDING"
				r.IsYielding = true
				r.YieldTicksLeft = 5 // ~500ms at sync
				r.Path = make([]Point, 0)
				r.PathIdx = 0
				localYieldAck = true
				r.Metrics.RecordCollision()
				r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
				log.Printf("🛑 [%s] YIELDING via 10Hz P2P (dist=%.2fm)", r.ID, distCurrent)
			}
		} else if r.Status == "YIELDING" && distCurrent > 1.2 {
			// Peer has cleared — resume with a fresh plan
			r.Status = "NAVIGATING_PICKUP"
			if r.CurrentTask != nil && r.CurrentTask.Status == "DELIVERING" {
				r.Status = "DELIVERING"
			}
			r.IsYielding = false
			r.YieldTicksLeft = 0
			r.Path = make([]Point, 0)
			r.PathIdx = 0
		}

		// ── Path-conflict detection: does peer's current position block MY path? ──
		if r.Status != "YIELDING" && sender.IsOnline && sender.Status != "OFFLINE_SIMULATED" {
			senderOnMyPath := r.isOnMyPath(sender.CurrentPos.X, sender.CurrentPos.Y)
			if senderOnMyPath {
				shouldReroute := r.shouldYieldToPeer(sender.RobotID, sender.PriorityScore, sender.CurrentPos, sender.TargetPos)
				if shouldReroute && len(r.Path) > 0 {
					log.Printf("🔄 [%s] PATH-CONFLICT: %s at (%.1f,%.1f) is on my path → REPLANNING",
						r.ID, sender.RobotID, sender.CurrentPos.X, sender.CurrentPos.Y)
					r.Path = make([]Point, 0)
					r.PathIdx = 0
					r.Status = "REPLANNING"
				}
			}
		}

		localSnap := RobotState{
			RobotID: r.ID,
			CurrentPos: Position{
				X:           r.CurrentX,
				Y:           r.CurrentY,
				TimestampMs: time.Now().UnixMilli(),
			},
			History:         r.History,
			IntendedPos:     Position{X: r.IntendedX, Y: r.IntendedY},
			TargetPos:       Position{X: r.TargetX, Y: r.TargetY},
			BatteryPct:      r.Battery,
			Status:          r.Status,
			CurrentTask:     r.CurrentTask,
			TasksCompleted:  r.TasksCompleted,
			PriorityScore:   r.PriorityScore,
			LastHeartbeatMs: time.Now().UnixMilli(),
			IsOnline:        r.IsOnline,
		}
		return localSnap, localYieldAck
	}()

	json.NewEncoder(w).Encode(SyncResponsePayload{
		Receiver:          snap,
		YieldAcknowledged: yieldAck,
	})
}

func (r *RobotNode) HandleGetRobotStatus(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	snap := r.GetSnapshot()
	json.NewEncoder(w).Encode(snap)
}

func (r *RobotNode) HandleToggleOnline(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload TogglePayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	if payload.BlockAisle {
		r.ReservationTable.SetAisleBlocked(payload.BlockedX, payload.BlockedY, true)
		r.Status = "REPLANNING"
		r.Path = make([]Point, 0)
		log.Printf("⚠️  [%s] REPLANNING around blocked aisle at (%.1f, %.1f)", r.ID, payload.BlockedX, payload.BlockedY)
	} else {
		r.IsOnline = payload.Enable
		if !r.IsOnline {
			r.Status = "OFFLINE_SIMULATED"
			r.Path = make([]Point, 0)
			r.PathIdx = 0
			r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
			log.Printf("🛑 [%s] Node KILLED / DISABLED via UI — frozen at (%.1f, %.1f)", r.ID, r.CurrentX, r.CurrentY)
		} else {
			r.Status = "IDLE"
			r.Battery = 98.0
			r.Path = make([]Point, 0)
			r.PathIdx = 0
			r.ReservationTable.RemoveIdlePeer(r.ID)
			log.Printf("⚡ [%s] Node RECOVERED via UI", r.ID)
		}
	}

	if payload.Mode != "" {
		r.Metrics.SetMode(payload.Mode)
	}
	r.mu.Unlock()

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func (r *RobotNode) HandleGetMetrics(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if req.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.Metrics.mu.RLock()
	defer r.Metrics.mu.RUnlock()

	json.NewEncoder(w).Encode(r.Metrics)
}

// StartP2PSyncLoop runs the physics engine, peer heartbeat checker, and
// 10Hz HTTP/3 QUIC P2P mesh gossip broadcast loop.
//
// Timing:
//   physicsTicker  100ms → 10Hz physics steps
//   syncTicker     100ms → 10Hz P2P broadcasts over QUIC (HTTP/3)
//   heartbeatCheck 300ms → 3× broadcast period; drop peers not heard in 300ms
func (r *RobotNode) StartP2PSyncLoop() {
	quicRoundTripper := &http3.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	quicClient := &http.Client{
		Transport: quicRoundTripper,
		Timeout:   120 * time.Millisecond,
	}
	stdClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 120 * time.Millisecond,
	}

	// 1. Dedicated 100ms Physics Engine Goroutine (10Hz)
	go func() {
		physicsTicker := time.NewTicker(100 * time.Millisecond)
		defer physicsTicker.Stop()
		for range physicsTicker.C {
			r.StepSimulation()
		}
	}()

	// 2. Dedicated 500ms Peer Heartbeat Goroutine with defer unlocking
	go func() {
		heartbeatTicker := time.NewTicker(500 * time.Millisecond)
		defer heartbeatTicker.Stop()
		for range heartbeatTicker.C {
			func() {
				r.mu.Lock()
				defer r.mu.Unlock()
				now := time.Now().UnixMilli()
				for peerID, lastSeen := range r.PeerLastSeen {
					if now-lastSeen > 600 {
						r.ReservationTable.PurgePeerReservations(peerID)
						delete(r.PeerStates, peerID)
						delete(r.PeerLastSeen, peerID)
						log.Printf("⚡ [%s] HTTP/3 Node-Drop: %s silent >600ms → purged reservations", r.ID, peerID)
					}
				}
			}()
		}
	}()

	// 3. Dedicated 150ms P2P Gossip Broadcast Goroutine
	go func() {
		syncTicker := time.NewTicker(150 * time.Millisecond)
		defer syncTicker.Stop()
		for range syncTicker.C {
			r.mu.RLock()
			online := r.IsOnline
			peers := make([]string, len(r.Peers))
			copy(peers, r.Peers)
			r.mu.RUnlock()

			if !online {
				continue
			}

			snap := r.GetSnapshot()
			for _, peerAddr := range peers {
				go func(peer string, s RobotState) {
					targetURL := peer
					if strings.HasPrefix(targetURL, "http://") {
						targetURL = "https://" + strings.TrimPrefix(targetURL, "http://")
					}

					payload := SyncPayload{Sender: s}
					body, _ := json.Marshal(payload)

					req, err := http.NewRequest("POST", targetURL+"/api/sync", bytes.NewReader(body))
					if err != nil {
						return
					}
					req.Header.Set("Content-Type", "application/json")

					resp, err := quicClient.Do(req)
					if err != nil {
						req2, _ := http.NewRequest("POST", targetURL+"/api/sync", bytes.NewReader(body))
						req2.Header.Set("Content-Type", "application/json")
						resp, err = stdClient.Do(req2)
						if err != nil {
							return
						}
					}
					defer resp.Body.Close()

					var syncResp SyncResponsePayload
					if err := json.NewDecoder(resp.Body).Decode(&syncResp); err == nil {
						if syncResp.YieldAcknowledged {
							log.Printf("✅ [%s] Peer %s acknowledged yield (P2P)", s.RobotID, syncResp.Receiver.RobotID)
						}
					}
				}(peerAddr, snap)
			}
		}
	}()
}
