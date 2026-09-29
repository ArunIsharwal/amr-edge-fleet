package node

import (
	"container/heap"
	"fmt"
	"math"
	"sync"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type TimeWindow struct {
	StartTimeMs int64 `json:"start_time_ms"`
	EndTimeMs   int64 `json:"end_time_ms"`
}

type ReservedCell struct {
	X        float64    `json:"x"`
	Y        float64    `json:"y"`
	Window   TimeWindow `json:"window"`
	RobotID  string     `json:"robot_id"`
	Priority int        `json:"priority"`
}

type ShelfRect struct {
	X float64
	Y float64
	W float64
	H float64
}

// Warehouse 6 Shelf Racks (matching GridCanvas.jsx exactly)
// 1.6m x 1.6m racks with generous 3.0m+ wide corridors and corners
var WarehouseShelves = []ShelfRect{
	{X: 3.0, Y: 2.0, W: 1.6, H: 1.6},  // R1 (West Top)
	{X: 3.0, Y: 6.4, W: 1.6, H: 1.6},  // R2 (West Bottom)
	{X: 8.2, Y: 2.0, W: 1.6, H: 1.6},  // R3 (Central Top)
	{X: 8.2, Y: 6.4, W: 1.6, H: 1.6},  // R4 (Central Bottom)
	{X: 13.4, Y: 2.0, W: 1.6, H: 1.6}, // R5 (East Top)
	{X: 13.4, Y: 6.4, W: 1.6, H: 1.6}, // R6 (East Bottom)
}

// IsInsideShelfObstacle checks if a coordinate falls inside or within safety margin of shelf racks
func IsInsideShelfObstacle(x, y float64, margin float64) bool {
	for _, s := range WarehouseShelves {
		if x >= s.X-margin && x <= s.X+s.W+margin && y >= s.Y-margin && y <= s.Y+s.H+margin {
			return true
		}
	}
	return false
}

type ReservationTable struct {
	mu                sync.RWMutex
	reservations      []ReservedCell
	blockedAisles     map[string]bool  // "x_y" -> true
	idlePeerPositions map[string]Point // robot_id -> physical position (stationary / idle peers)
}

func NewReservationTable() *ReservationTable {
	return &ReservationTable{
		reservations:      make([]ReservedCell, 0),
		blockedAisles:     make(map[string]bool),
		idlePeerPositions: make(map[string]Point),
	}
}

func (rt *ReservationTable) AddReservation(cell ReservedCell) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	// Purge stale entries (older than 5 seconds) and previous reservations from same robot
	cutoff := cell.Window.StartTimeMs - 5000
	filtered := make([]ReservedCell, 0, len(rt.reservations))
	for _, r := range rt.reservations {
		if r.Window.EndTimeMs >= cutoff && r.RobotID != cell.RobotID {
			filtered = append(filtered, r)
		}
	}
	rt.reservations = append(filtered, cell)
}

func (rt *ReservationTable) PurgePeerReservations(peerID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	filtered := make([]ReservedCell, 0, len(rt.reservations))
	for _, r := range rt.reservations {
		if r.RobotID != peerID {
			filtered = append(filtered, r)
		}
	}
	rt.reservations = filtered
	delete(rt.idlePeerPositions, peerID)
}

func (rt *ReservationTable) UpdateIdlePeer(peerID string, pos Point) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.idlePeerPositions[peerID] = pos
}

func (rt *ReservationTable) RemoveIdlePeer(peerID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	delete(rt.idlePeerPositions, peerID)
}

func (rt *ReservationTable) SetAisleBlocked(x, y float64, blocked bool) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	key := cellKey(x, y)
	if blocked {
		rt.blockedAisles[key] = true
	} else {
		delete(rt.blockedAisles, key)
	}
}

// IsCellAvailable evaluates space-time reservations, physical clearance, and shelf boundaries.
// All time windows are calibrated to the 100ms (10Hz) physics/sync cycle.
func (rt *ReservationTable) IsCellAvailable(x, y float64, timeMs int64, excludeRobot string, priority int) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	// 1. Grid boundary check (18m x 10m grid)
	if x < 0.5 || x > 17.5 || y < 0.5 || y > 9.5 {
		return false
	}

	// 2. Static shelf obstacle check (0.15m safety margin for wide corridor usage)
	if IsInsideShelfObstacle(x, y, 0.15) {
		return false
	}

	// 3. Dynamic aisle fault check
	key := cellKey(x, y)
	if rt.blockedAisles[key] {
		return false
	}

	// 4. Idle/stopped peer check — 1.4m physical clearance
	for peerID, p := range rt.idlePeerPositions {
		if peerID == excludeRobot {
			continue
		}
		if math.Hypot(p.X-x, p.Y-y) < 1.4 {
			return false
		}
	}

	// 5. Time-windowed space-time reservation check — 0.8m physical clearance.
	// Buffer is ±100ms to match 300ms cell travel time calibration.
	for _, res := range rt.reservations {
		if res.RobotID == excludeRobot {
			continue
		}
		if timeMs >= res.Window.StartTimeMs-100 && timeMs <= res.Window.EndTimeMs+100 {
			dist := math.Hypot(res.X-x, res.Y-y)
			if dist < 0.8 {
				return false
			}
		}
	}

	return true
}

func cellKey(x, y float64) string {
	gridX := int(math.Floor(x))
	gridY := int(math.Floor(y))
	return fmt.Sprintf("%d_%d", gridX, gridY)
}

// A* Node for Time-Windowed Space-Time Search (X, Y, TimeMs)
type AStarNode struct {
	X      float64
	Y      float64
	GCost  float64
	HCost  float64
	FCost  float64
	TimeMs int64
	Parent *AStarNode
	index  int
}

type PriorityQueue []*AStarNode

func (pq PriorityQueue) Len() int           { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool { return pq[i].FCost < pq[j].FCost }
func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}
func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*AStarNode)
	item.index = n
	*pq = append(*pq, item)
}
func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.index = -1
	*pq = old[0 : n-1]
	return item
}

// PlanSpaceTimePath runs Space-Time A* with 0.5m grid steps and 300ms time steps.
// At 0.18m per 100ms tick (1.8 m/s), crossing a 0.5m grid cell takes ~300ms (3 ticks).
// Max iterations set to 10000 to search entire warehouse canvas grid.
func (rt *ReservationTable) PlanSpaceTimePath(start, target Point, startTimeMs int64, robotID string, priority int) []Point {
	sx := math.Round(start.X*2) / 2
	sy := math.Round(start.Y*2) / 2
	tx := math.Round(target.X*2) / 2
	ty := math.Round(target.Y*2) / 2

	openPQ := &PriorityQueue{}
	heap.Init(openPQ)

	startNode := &AStarNode{
		X:      sx,
		Y:      sy,
		GCost:  0,
		HCost:  math.Hypot(tx-sx, ty-sy),
		FCost:  math.Hypot(tx-sx, ty-sy),
		TimeMs: startTimeMs,
	}
	heap.Push(openPQ, startNode)

	visited := make(map[string]bool)

	// Directions: Right, Left, Down, Up, Wait-in-place
	dx := []float64{0.5, -0.5, 0, 0, 0}
	dy := []float64{0, 0, 0.5, -0.5, 0}

	iter := 0
	maxIter := 10000

	for openPQ.Len() > 0 && iter < maxIter {
		iter++
		current := heap.Pop(openPQ).(*AStarNode)

		// Reached target within 0.6m radius
		if math.Hypot(current.X-tx, current.Y-ty) < 0.6 {
			path := []Point{}
			curr := current
			for curr != nil {
				path = append([]Point{{X: curr.X, Y: curr.Y}}, path...)
				curr = curr.Parent
			}
			return path
		}

		// Visited key buckets by 300ms cell travel time
		key := fmt.Sprintf("%.1f_%.1f_%d", current.X, current.Y, current.TimeMs/300)
		if visited[key] {
			continue
		}
		visited[key] = true

		for i := 0; i < 5; i++ {
			nextX := current.X + dx[i]
			nextY := current.Y + dy[i]
			nextTime := current.TimeMs + 300 // 300ms per cell step

			if !rt.IsCellAvailable(nextX, nextY, nextTime, robotID, priority) {
				continue
			}

			g := current.GCost + 0.5
			if dx[i] == 0 && dy[i] == 0 {
				g += 0.3 // Wait penalty — prefer moving over waiting
			}
			h := math.Hypot(tx-nextX, ty-nextY)

			neighbor := &AStarNode{
				X:      nextX,
				Y:      nextY,
				GCost:  g,
				HCost:  h,
				FCost:  g + h,
				TimeMs: nextTime,
				Parent: current,
			}
			heap.Push(openPQ, neighbor)
		}
	}

	// Primary A* exhausted — try relaxed fallback searching entire canvas
	return rt.PlanFallbackPath(start, target, robotID)
}

// PlanFallbackPath is a standard A* (no time dimension) searching the ENTIRE warehouse canvas.
// It takes a single lock snapshot of idle peers with 0.8m clearance to find any open path.
func (rt *ReservationTable) PlanFallbackPath(start, target Point, robotID string) []Point {
	sx := math.Round(start.X*2) / 2
	sy := math.Round(start.Y*2) / 2
	tx := math.Round(target.X*2) / 2
	ty := math.Round(target.Y*2) / 2

	rt.mu.RLock()
	idleSnap := make(map[string]Point, len(rt.idlePeerPositions))
	for k, v := range rt.idlePeerPositions {
		if k != robotID {
			idleSnap[k] = v
		}
	}
	rt.mu.RUnlock()

	openPQ := &PriorityQueue{}
	heap.Init(openPQ)

	startNode := &AStarNode{
		X:     sx,
		Y:     sy,
		GCost: 0,
		HCost: math.Hypot(tx-sx, ty-sy),
		FCost: math.Hypot(tx-sx, ty-sy),
	}
	heap.Push(openPQ, startNode)

	visited := make(map[string]bool)

	dx := []float64{0.5, -0.5, 0, 0}
	dy := []float64{0, 0, 0.5, -0.5}

	iter := 0
	for openPQ.Len() > 0 && iter < 10000 {
		iter++
		current := heap.Pop(openPQ).(*AStarNode)

		if math.Hypot(current.X-tx, current.Y-ty) < 0.6 {
			path := []Point{}
			curr := current
			for curr != nil {
				path = append([]Point{{X: curr.X, Y: curr.Y}}, path...)
				curr = curr.Parent
			}
			return path
		}

		key := fmt.Sprintf("%.1f_%.1f", current.X, current.Y)
		if visited[key] {
			continue
		}
		visited[key] = true

		for i := 0; i < 4; i++ {
			nextX := current.X + dx[i]
			nextY := current.Y + dy[i]

			if nextX < 0.5 || nextX > 17.5 || nextY < 0.5 || nextY > 9.5 {
				continue
			}
			if IsInsideShelfObstacle(nextX, nextY, 0.25) {
				continue
			}
			// Check idle peer snapshot with 0.8m physical clearance
			blockedByIdle := false
			for _, p := range idleSnap {
				if math.Hypot(p.X-nextX, p.Y-nextY) < 0.8 {
					blockedByIdle = true
					break
				}
			}
			if blockedByIdle {
				continue
			}

			g := current.GCost + 0.5
			h := math.Hypot(tx-nextX, ty-nextY)

			neighbor := &AStarNode{
				X:      nextX,
				Y:      nextY,
				GCost:  g,
				HCost:  h,
				FCost:  g + h,
				Parent: current,
			}
			heap.Push(openPQ, neighbor)
		}
	}

	return []Point{}
}
