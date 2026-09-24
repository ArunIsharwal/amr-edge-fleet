package node

import (
	"math"
	mathrand "math/rand"
	"sync"
	"time"
)

type Position struct {
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	TimestampMs int64   `json:"timestamp_ms"`
}

type RobotState struct {
	RobotID         string     `json:"robot_id"`
	CurrentPos      Position   `json:"current_pos"`
	History         []Position `json:"history"` // Ring buffer of past 5 positions
	IntendedPos     Position   `json:"intended_pos"`
	BatteryPct      float64    `json:"battery_pct"`
	Status          string     `json:"status"` // "MOVING", "YIELDING", "REPLANNING", "OFFLINE_SIMULATED", "DELIVERING"
	CurrentTaskID   string     `json:"current_task_id"`
	TasksCompleted  int        `json:"tasks_completed"`
	TargetPos       Position   `json:"target_pos"`
	LastHeartbeatMs int64      `json:"last_heartbeat_ms"`
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
	CurrentTaskID    string
	TasksCompleted   int
	ReservationTable *ReservationTable
	Metrics          *MetricsEngine
	TargetX          float64
	TargetY          float64
	// Task system
	Waypoints      []Position // Ordered task waypoints
	WaypointIdx    int
	YieldTicksLeft int
	TaskStartTime  time.Time
}

// Warehouse task waypoints for 10m x 10m grid
var WarehouseWaypoints = []Position{
	{X: 1.0, Y: 1.0},
	{X: 5.0, Y: 1.0},
	{X: 9.0, Y: 1.0},
	{X: 9.0, Y: 5.0},
	{X: 9.0, Y: 9.0},
	{X: 5.0, Y: 9.0},
	{X: 1.0, Y: 9.0},
	{X: 1.0, Y: 5.0},
	{X: 3.0, Y: 3.0},
	{X: 7.0, Y: 3.0},
	{X: 7.0, Y: 7.0},
	{X: 3.0, Y: 7.0},
	{X: 5.0, Y: 5.0},
}

func NewRobotNode(id string, startX, startY float64, peers []string) *RobotNode {
	// Each robot starts with a different initial waypoint offset
	waypointOffset := 0
	switch id {
	case "AMR-01":
		waypointOffset = 0
	case "AMR-02":
		waypointOffset = 4
	case "AMR-03":
		waypointOffset = 8
	}

	node := &RobotNode{
		ID:               id,
		CurrentX:         startX,
		CurrentY:         startY,
		Battery:          98.0,
		Status:           "MOVING",
		Peers:            peers,
		IsOnline:         true,
		History:          make([]Position, 0),
		ReservationTable: NewReservationTable(),
		Metrics:          NewMetricsEngine(),
		WaypointIdx:      waypointOffset % len(WarehouseWaypoints),
		TasksCompleted:   0,
		TaskStartTime:    time.Now(),
	}
	target := WarehouseWaypoints[node.WaypointIdx]
	node.TargetX = target.X
	node.TargetY = target.Y
	return node
}

// PickNextWaypoint advances to the next task waypoint
func (r *RobotNode) PickNextWaypoint() {
	r.WaypointIdx = (r.WaypointIdx + 1) % len(WarehouseWaypoints)
	// Skip waypoints that are too close to current position
	for i := 0; i < len(WarehouseWaypoints); i++ {
		wp := WarehouseWaypoints[r.WaypointIdx]
		dist := math.Hypot(wp.X-r.CurrentX, wp.Y-r.CurrentY)
		if dist > 1.5 {
			break
		}
		r.WaypointIdx = (r.WaypointIdx + 1) % len(WarehouseWaypoints)
	}
	target := WarehouseWaypoints[r.WaypointIdx]
	r.TargetX = target.X
	r.TargetY = target.Y
}

// StepSimulation advances the robot by one physics tick (called every 200ms)
func (r *RobotNode) StepSimulation() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.IsOnline || r.Status == "OFFLINE_SIMULATED" {
		return
	}

	// Handle yielding countdown
	if r.YieldTicksLeft > 0 {
		r.YieldTicksLeft--
		if r.YieldTicksLeft == 0 {
			r.Status = "MOVING"
			r.IsYielding = false
		}
		return
	}

	// Compute direction to target
	dx := r.TargetX - r.CurrentX
	dy := r.TargetY - r.CurrentY
	dist := math.Hypot(dx, dy)

	if dist < 0.4 {
		// Reached waypoint — record task completion
		duration := time.Since(r.TaskStartTime).Seconds()
		r.Metrics.RecordTaskDone(duration)
		r.TasksCompleted++
		r.CurrentTaskID = ""
		r.TaskStartTime = time.Now()
		r.Status = "MOVING"
		r.PickNextWaypoint()
		r.CurrentTaskID = WarehouseWaypoints[r.WaypointIdx].String()
		return
	}

	// Move step towards target
	speed := 0.30 // meters per tick
	if r.Status == "REPLANNING" {
		speed = 0.15 // slower while replanning
	}

	nextX := r.CurrentX + (dx/dist)*speed
	nextY := r.CurrentY + (dy/dist)*speed

	// Clamp to grid bounds
	nextX = math.Max(0.3, math.Min(9.7, nextX))
	nextY = math.Max(0.3, math.Min(9.7, nextY))

	// Update ring buffer history (max 5 entries)
	r.History = append([]Position{{
		X:           r.CurrentX,
		Y:           r.CurrentY,
		TimestampMs: time.Now().UnixMilli(),
	}}, r.History...)
	if len(r.History) > 5 {
		r.History = r.History[:5]
	}

	r.CurrentX = nextX
	r.CurrentY = nextY
	r.IntendedX = nextX + (dx/dist)*speed
	r.IntendedY = nextY + (dy/dist)*speed
	r.Battery = math.Max(10.0, r.Battery-0.008)

	if r.Status != "REPLANNING" {
		r.Status = "MOVING"
	}

	// Small random perturbation to make motion look organic
	if mathrand.Float64() < 0.05 {
		r.CurrentX += (mathrand.Float64() - 0.5) * 0.05
		r.CurrentY += (mathrand.Float64() - 0.5) * 0.05
	}
}

// UpdatePosition manages the 4-position ring buffer (legacy compatibility)
func (r *RobotNode) UpdatePosition(newX, newY float64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.History = append([]Position{{
		X:           r.CurrentX,
		Y:           r.CurrentY,
		TimestampMs: time.Now().UnixMilli(),
	}}, r.History...)
	if len(r.History) > 5 {
		r.History = r.History[:5]
	}

	r.CurrentX = newX
	r.CurrentY = newY

	dx := r.TargetX - r.CurrentX
	dy := r.TargetY - r.CurrentY
	dist := math.Hypot(dx, dy)

	if dist < 0.5 {
		r.PickNextWaypoint()
	} else {
		r.IntendedX = r.CurrentX + (dx/dist)*0.4
		r.IntendedY = r.CurrentY + (dy/dist)*0.4
	}

	r.Battery = math.Max(10.0, r.Battery-0.005)
}

func (r *RobotNode) GetSnapshot() RobotState {
	r.mu.RLock()
	defer r.mu.RUnlock()

	hist := make([]Position, len(r.History))
	copy(hist, r.History)

	return RobotState{
		RobotID: r.ID,
		CurrentPos: Position{
			X:           r.CurrentX,
			Y:           r.CurrentY,
			TimestampMs: time.Now().UnixMilli(),
		},
		History: hist,
		IntendedPos: Position{
			X: r.IntendedX,
			Y: r.IntendedY,
		},
		TargetPos: Position{
			X: r.TargetX,
			Y: r.TargetY,
		},
		BatteryPct:      r.Battery,
		Status:          r.Status,
		CurrentTaskID:   r.CurrentTaskID,
		TasksCompleted:  r.TasksCompleted,
		LastHeartbeatMs: time.Now().UnixMilli(),
	}
}

// String helper for Position
func (p Position) String() string {
	return ""
}
