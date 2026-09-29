package node

import (
	"fmt"
	"math"
	"sync"
	"time"
)

type Position struct {
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	TimestampMs int64   `json:"timestamp_ms"`
}

func (p Position) String() string {
	return fmt.Sprintf("(%.1f, %.1f)", p.X, p.Y)
}

type RobotState struct {
	RobotID         string     `json:"robot_id"`
	CurrentPos      Position   `json:"current_pos"`
	History         []Position `json:"history"`
	IntendedPos     Position   `json:"intended_pos"`
	BatteryPct      float64    `json:"battery_pct"`
	Status          string     `json:"status"` // IDLE | NAVIGATING_PICKUP | DELIVERING | YIELDING | REPLANNING | OFFLINE_SIMULATED
	CurrentTask     *Task      `json:"current_task"`
	TasksCompleted  int        `json:"tasks_completed"`
	TargetPos       Position   `json:"target_pos"`
	Path            []Point    `json:"path"`
	PriorityScore   int        `json:"priority_score"`
	LastHeartbeatMs int64      `json:"last_heartbeat_ms"`
	IsOnline        bool       `json:"is_online"`
}

type RobotNode struct {
	mu               sync.RWMutex
	ID               string
	CurrentX         float64
	CurrentY         float64
	History          []Position
	IntendedX        float64
	IntendedY        float64
	Battery          float64
	Status           string
	Peers            []string
	IsYielding       bool
	IsOnline         bool
	TasksCompleted   int
	ReservationTable *ReservationTable
	Metrics          *MetricsEngine
	TaskManager      *TaskManager
	CurrentTask      *Task
	TargetX          float64
	TargetY          float64
	PriorityScore    int
	Path             []Point
	PathIdx          int
	YieldTicksLeft     int
	YieldCooldownTicks int
	ReplanFailCount    int
	TaskStartTime    time.Time
	PeerLastSeen     map[string]int64
	PeerStates       map[string]RobotState
}

// Warehouse waypoints in open corridors — used for autonomous fleet patrols
var FleetWaypoints = []Point{
	{X: 1.0, Y: 1.0},
	{X: 6.0, Y: 1.0},
	{X: 11.0, Y: 1.0},
	{X: 16.5, Y: 1.0},
	{X: 16.5, Y: 5.0},
	{X: 16.5, Y: 9.0},
	{X: 11.0, Y: 9.0},
	{X: 6.0, Y: 9.0},
	{X: 1.0, Y: 9.0},
	{X: 1.0, Y: 5.0},
	{X: 6.0, Y: 5.0},
	{X: 11.0, Y: 5.0},
}

func NewRobotNode(id string, startX, startY float64, peers []string) *RobotNode {
	rt := NewReservationTable()
	node := &RobotNode{
		ID:               id,
		CurrentX:         startX,
		CurrentY:         startY,
		Battery:          98.0,
		Status:           "IDLE",
		Peers:            peers,
		IsOnline:         true,
		History:          make([]Position, 0),
		ReservationTable: rt,
		Metrics:          NewMetricsEngine(),
		TaskManager:      NewTaskManager(),
		TasksCompleted:   0,
		TaskStartTime:    time.Now(),
		Path:             make([]Point, 0),
		PathIdx:          0,
		PeerLastSeen:     make(map[string]int64),
		PeerStates:       make(map[string]RobotState),
		TargetX:          startX,
		TargetY:          startY,
		ReplanFailCount:  0,
		YieldCooldownTicks: 0,
	}
	offset := 0
	fmt.Sscanf(id, "AMR-%d", &offset)
	if offset < 1 {
		offset = 1
	}
	wpIdx := ((offset - 1) * 2) % len(FleetWaypoints)
	node.setTargetWaypoint(FleetWaypoints[wpIdx])
	return node
}

func (r *RobotNode) setTargetWaypoint(wp Point) {
	task := Task{
		ID:         fmt.Sprintf("AUTO-%s-%d", r.ID, time.Now().UnixMilli()%9999),
		Pickup:     Point{X: r.CurrentX, Y: r.CurrentY},
		Dropoff:    wp,
		Priority:   50,
		CreatedAt:  time.Now().UnixMilli(),
		Status:     "DELIVERING",
		AssignedTo: r.ID,
	}
	r.CurrentTask = &task
	r.TargetX = wp.X
	r.TargetY = wp.Y
	r.Status = "DELIVERING"
	r.Path = nil
	r.PathIdx = 0
	r.TaskStartTime = time.Now()
	r.PriorityScore = 50
	r.ReplanFailCount = 0
	r.ReservationTable.RemoveIdlePeer(r.ID)
}

func (r *RobotNode) CalculatePriorityScore() int {
	r.mu.RLock()
	task := r.CurrentTask
	cx, cy := r.CurrentX, r.CurrentY
	tx, ty := r.TargetX, r.TargetY
	r.mu.RUnlock()
	if task == nil {
		return 0
	}
	waitSec := (time.Now().UnixMilli() - task.CreatedAt) / 1000
	distToTarget := math.Hypot(tx-cx, ty-cy)
	score := task.Priority + int(waitSec*2) - int(distToTarget)
	if score < 1 {
		return 1
	}
	return score
}

func (r *RobotNode) AssignTask(t Task) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t.AssignedTo != "" && t.AssignedTo != r.ID {
		r.TaskManager.AddOrUpdateTask(t)
		return
	}
	if t.CreatedAt == 0 {
		t.CreatedAt = time.Now().UnixMilli()
	}
	t.AssignedTo = r.ID
	if math.Hypot(t.Pickup.X-r.CurrentX, t.Pickup.Y-r.CurrentY) < 0.6 {
		t.Status = "DELIVERING"
		r.Status = "DELIVERING"
		r.TargetX = t.Dropoff.X
		r.TargetY = t.Dropoff.Y
	} else {
		t.Status = "NAVIGATING_PICKUP"
		r.Status = "NAVIGATING_PICKUP"
		r.TargetX = t.Pickup.X
		r.TargetY = t.Pickup.Y
	}
	r.CurrentTask = &t
	r.Path = nil
	r.PathIdx = 0
	r.TaskStartTime = time.Now()
	r.PriorityScore = t.Priority
	r.ReplanFailCount = 0
	r.ReservationTable.RemoveIdlePeer(r.ID)
}

func (r *RobotNode) pickNextWaypoint() {
	offset := 0
	fmt.Sscanf(r.ID, "AMR-%d", &offset)
	if offset < 1 {
		offset = 1
	}

	// Cycle through FleetWaypoints — always pick a waypoint >1.5m away
	// so we never instantly complete a task at our current position.
	base := (offset*3 + r.TasksCompleted) % len(FleetWaypoints)
	nextWp := FleetWaypoints[base]
	for attempt := 0; attempt < len(FleetWaypoints); attempt++ {
		idx := (base + attempt) % len(FleetWaypoints)
		wp := FleetWaypoints[idx]
		if math.Hypot(wp.X-r.CurrentX, wp.Y-r.CurrentY) > 1.5 {
			nextWp = wp
			break
		}
	}

	task := Task{
		ID:         fmt.Sprintf("AUTO-%s-%d", r.ID, time.Now().UnixMilli()%9999),
		Pickup:     Point{X: r.CurrentX, Y: r.CurrentY},
		Dropoff:    nextWp,
		Priority:   50,
		CreatedAt:  time.Now().UnixMilli(),
		Status:     "DELIVERING",
		AssignedTo: r.ID,
	}
	r.CurrentTask = &task
	r.TargetX = nextWp.X
	r.TargetY = nextWp.Y
	r.Status = "DELIVERING"
	r.Path = nil
	r.PathIdx = 0
	r.TaskStartTime = time.Now()
	r.PriorityScore = 50
	r.ReplanFailCount = 0
	r.ReservationTable.RemoveIdlePeer(r.ID)
}

// shouldYieldToPeer evaluates priority rules for right-of-way between two robots:
// 1. Base Task Priority Score (higher score wins right-of-way, e.g. 100 > 75 > 50 > 25).
// 2. Equal Base Priority: Robot CLOSER to its target goal wins right-of-way!
// 3. Goal Distances tied within 0.05m: Fallback to string ID comparison to prevent oscillation.
func (r *RobotNode) shouldYieldToPeer(peerID string, peerPriority int, peerPos, peerTarget Position) bool {
	myPriority := r.PriorityScore
	if myPriority < peerPriority {
		return true
	}
	if myPriority > peerPriority {
		return false
	}

	// Base priorities are equal -> Robot CLOSER to its goal wins right-of-way!
	myDistToGoal := math.Hypot(r.TargetX-r.CurrentX, r.TargetY-r.CurrentY)
	peerDistToGoal := math.Hypot(peerTarget.X-peerPos.X, peerTarget.Y-peerPos.Y)

	if myDistToGoal > peerDistToGoal+0.05 {
		return true // Farther from goal -> yield
	}
	if peerDistToGoal > myDistToGoal+0.05 {
		return false // Closer to goal -> proceed
	}

	// Goal distances tied within 0.05m -> string ID fallback
	return r.ID > peerID
}

// checkInterRobotCollisionRisk is the FIRST gate in StepSimulation, matching
// the flowchart box "Inter-Robot Collision Risk?".
// Returns (collisionRisk bool, shouldYield bool, peerID string, peerPriority int).
// Called while holding r.mu.
func (r *RobotNode) checkInterRobotCollisionRisk(nx, ny float64) (bool, bool, string, int) {
	const safetyDist = 0.8 // Physical box body clearance (no body overlap)
	for peerID, peerState := range r.PeerStates {
		if peerID == r.ID {
			continue
		}
		if !peerState.IsOnline || peerState.Status == "OFFLINE_SIMULATED" {
			continue
		}
		d := math.Hypot(nx-peerState.CurrentPos.X, ny-peerState.CurrentPos.Y)
		if d < safetyDist {
			shouldYield := r.shouldYieldToPeer(peerID, peerState.PriorityScore, peerState.CurrentPos, peerState.TargetPos)
			return true, shouldYield, peerID, peerState.PriorityScore
		}
	}
	return false, false, "", 0
}

// StepSimulation implements the 100ms cycle loop from the architecture flowchart:
//
//	Read Input (peer states already updated by 10Hz HandleSyncState)
//	  → Inter-Robot Collision Risk?
//	      YES (lower priority) → Lower Priority Node Yields & Pauses
//	      NO  → Reserve Time-Space Cell via Time-Windowed A*
//	              → Aisle Blocked? → Instant Local A* Path Re-Plan
//	              → Move along reserved path
func (r *RobotNode) StepSimulation() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// ── Offline guard ────────────────────────────────────────────────────────
	if !r.IsOnline || r.Status == "OFFLINE_SIMULATED" {
		r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
		return
	}

	// ── Auto-assign if idle ──────────────────────────────────────────────────
	if r.Status == "IDLE" || r.CurrentTask == nil {
		r.pickNextWaypoint()
	}

	r.ReservationTable.RemoveIdlePeer(r.ID)

	// ── Yield cooldown drain ─────────────────────────────────────────────────
	if r.YieldCooldownTicks > 0 {
		r.YieldCooldownTicks--
	}

	// ── FLOWCHART BOX: "Inter-Robot Collision Risk?" ─────────────────────────
	// Always check proximity regardless of cooldown — cooldown only suppresses
	// triggering a NEW yield, not detecting a dangerous proximity condition.
	if r.YieldTicksLeft == 0 {
		if risk, shouldYield, peerID, _ := r.checkInterRobotCollisionRisk(r.CurrentX, r.CurrentY); risk {
			_ = peerID
			if shouldYield && r.YieldCooldownTicks == 0 {
				// Lower Priority Node Yields & Pauses
				r.Status = "YIELDING"
				r.IsYielding = true
				r.YieldTicksLeft = 5 // 5 × 100ms = 500ms pause
				r.Path = nil
				r.PathIdx = 0
				r.Metrics.RecordCollision()
				r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
				return
			}
			// Higher priority: force replan around yielding peer, BUT DO NOT STOP.
			if len(r.Path) > 0 {
				r.Path = nil
				r.PathIdx = 0
			}
		}
	}

	// ── Handle active yield countdown ────────────────────────────────────────
	if r.YieldTicksLeft > 0 {
		r.YieldTicksLeft--
		if r.YieldTicksLeft == 0 {
			// Resume immediately with a fresh canvas-wide A* replan around peer
			r.IsYielding = false
			r.Path = nil // Force fresh A* replan after yield
			r.PathIdx = 0
			r.YieldCooldownTicks = 8 // 800ms grace cooldown before triggering another yield
			r.ReservationTable.RemoveIdlePeer(r.ID)
			if r.CurrentTask != nil && r.CurrentTask.Status == "DELIVERING" {
				r.Status = "DELIVERING"
			} else {
				r.Status = "NAVIGATING_PICKUP"
			}
		} else {
			// Still counting down — stay registered as idle so peers route around us
			r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
			return
		}
	}

	// ── Target reached ───────────────────────────────────────────────────────
	distToTarget := math.Hypot(r.TargetX-r.CurrentX, r.TargetY-r.CurrentY)
	if distToTarget < 0.6 {
		if r.CurrentTask != nil && r.CurrentTask.Status == "DELIVERING" {
			r.Metrics.RecordTaskDone(time.Since(r.TaskStartTime).Seconds())
			r.TasksCompleted++
			r.CurrentTask.Status = "COMPLETED"
			r.TaskManager.AddOrUpdateTask(*r.CurrentTask)
			r.pickNextWaypoint()
			return
		}
		if r.CurrentTask != nil && r.Status == "NAVIGATING_PICKUP" {
			r.CurrentTask.Status = "DELIVERING"
			r.Status = "DELIVERING"
			r.TargetX = r.CurrentTask.Dropoff.X
			r.TargetY = r.CurrentTask.Dropoff.Y
			r.Path = nil
			r.PathIdx = 0
			r.ReplanFailCount = 0
			return
		}
		r.pickNextWaypoint()
		return
	}

	if r.CurrentTask == nil {
		r.Status = "IDLE"
		return
	}
	r.PriorityScore = r.CurrentTask.Priority

	// ── FLOWCHART BOX: "Reserve Time-Space Cell via Time-Windowed A*" ────────
	// Plan or replan path if we don't have one. A* internally registers
	// space-time cell reservations for every waypoint it produces.
	if len(r.Path) == 0 || r.PathIdx >= len(r.Path) {
		start := Point{X: r.CurrentX, Y: r.CurrentY}
		target := Point{X: r.TargetX, Y: r.TargetY}
		newPath := r.ReservationTable.PlanSpaceTimePath(start, target, time.Now().UnixMilli(), r.ID, r.PriorityScore)

		// FLOWCHART BOX: "Aisle Blocked or Node Drop? → Instant Local A* Path Re-Plan"
		if len(newPath) == 0 {
			r.ReplanFailCount++
			if r.ReplanFailCount >= 5 {
				// Completely stuck — reset to IDLE so auto-assign at top of
				// StepSimulation picks a fresh waypoint next tick.
				r.Status = "IDLE"
				r.CurrentTask = nil
				r.Path = nil
				r.PathIdx = 0
				r.ReplanFailCount = 0
				r.ReservationTable.RemoveIdlePeer(r.ID)
				return
			}
			// Instant replan: will retry next 100ms tick
			r.Status = "REPLANNING"
			return
		}
		r.ReplanFailCount = 0
		r.Path = newPath
		r.PathIdx = 0
		if r.Status == "REPLANNING" {
			if r.CurrentTask != nil && r.CurrentTask.Status == "DELIVERING" {
				r.Status = "DELIVERING"
			} else {
				r.Status = "NAVIGATING_PICKUP"
			}
		}
	}

	// ── Execute movement along reserved path ─────────────────────────────────
	if r.PathIdx >= len(r.Path) {
		return
	}
	nextPoint := r.Path[r.PathIdx]
	dx := nextPoint.X - r.CurrentX
	dy := nextPoint.Y - r.CurrentY
	distToNext := math.Hypot(dx, dy)

	if distToNext < 0.25 {
		r.PathIdx++
		return
	}

	speed := 0.18 // 0.18m per 100ms tick = 1.8 m/s
	step := math.Min(speed, distToNext)
	proposedX := r.CurrentX + (dx/distToNext)*step
	proposedY := r.CurrentY + (dy/distToNext)*step

	// ── Final pre-move collision gate (safety net for same-tick races) ───────
	// Even though we checked at the top, a peer might have moved toward us
	// during path planning. This closes the last gap.
	if risk, shouldYield, peerID, _ := r.checkInterRobotCollisionRisk(proposedX, proposedY); risk {
		_ = peerID
		if shouldYield && r.YieldCooldownTicks == 0 {
			r.Status = "YIELDING"
			r.IsYielding = true
			r.YieldTicksLeft = 5
			r.Path = nil
			r.PathIdx = 0
			r.Metrics.RecordCollision()
			r.ReservationTable.UpdateIdlePeer(r.ID, Point{X: r.CurrentX, Y: r.CurrentY})
			return
		}
		// Higher priority: skip this step to avoid body collision & replan
		if len(r.Path) > 0 {
			r.Path = nil
			r.PathIdx = 0
		}
		return
	}

	// ── Commit position update ───────────────────────────────────────────────
	r.CurrentX = proposedX
	r.CurrentY = proposedY
	r.IntendedX = r.CurrentX + (dx/distToNext)*step
	r.IntendedY = r.CurrentY + (dy/distToNext)*step

	r.History = append([]Position{{X: r.CurrentX, Y: r.CurrentY, TimestampMs: time.Now().UnixMilli()}}, r.History...)
	if len(r.History) > 5 {
		r.History = r.History[:5]
	}

	r.Battery = math.Max(10.0, r.Battery-0.002)

	if r.Status != "YIELDING" {
		if r.CurrentTask != nil && r.CurrentTask.Status == "DELIVERING" {
			r.Status = "DELIVERING"
		} else {
			r.Status = "NAVIGATING_PICKUP"
		}
	}
}

func (r *RobotNode) GetSnapshot() RobotState {
	r.mu.RLock()
	defer r.mu.RUnlock()

	hist := make([]Position, len(r.History))
	copy(hist, r.History)

	remPath := make([]Point, 0)
	if r.PathIdx < len(r.Path) {
		remPath = r.Path[r.PathIdx:]
	}

	return RobotState{
		RobotID: r.ID,
		CurrentPos: Position{
			X:           r.CurrentX,
			Y:           r.CurrentY,
			TimestampMs: time.Now().UnixMilli(),
		},
		History:         hist,
		IntendedPos:     Position{X: r.IntendedX, Y: r.IntendedY},
		TargetPos:       Position{X: r.TargetX, Y: r.TargetY},
		BatteryPct:      r.Battery,
		Status:          r.Status,
		CurrentTask:     r.CurrentTask,
		TasksCompleted:  r.TasksCompleted,
		Path:            remPath,
		PriorityScore:   r.PriorityScore,
		LastHeartbeatMs: time.Now().UnixMilli(),
		IsOnline:        r.IsOnline,
	}
}
