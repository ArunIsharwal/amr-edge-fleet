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
	X       float64    `json:"x"`
	Y       float64    `json:"y"`
	Window  TimeWindow `json:"window"`
	RobotID string     `json:"robot_id"`
}

type ReservationTable struct {
	mu            sync.RWMutex
	reservations  []ReservedCell
	blockedAisles map[string]bool // "x_y" -> true
}

func NewReservationTable() *ReservationTable {
	return &ReservationTable{
		reservations:  make([]ReservedCell, 0),
		blockedAisles: make(map[string]bool),
	}
}

func (rt *ReservationTable) AddReservation(cell ReservedCell) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.reservations = append(rt.reservations, cell)
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

func (rt *ReservationTable) IsCellAvailable(x, y float64, timeMs int64, excludeRobot string) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	// Check static obstacle / blocked aisle
	key := cellKey(x, y)
	if rt.blockedAisles[key] {
		return false
	}

	// Check time-windowed reservation conflicts
	for _, res := range rt.reservations {
		if res.RobotID == excludeRobot {
			continue
		}
		dist := math.Hypot(res.X-x, res.Y-y)
		if dist < 1.0 && timeMs >= res.Window.StartTimeMs && timeMs <= res.Window.EndTimeMs {
			return false
		}
	}
	return true
}

func cellKey(x, y float64) string {
	gridX := int(math.Floor(x))
	gridY := int(math.Floor(y))
	return fmt.Sprintf("%d_%d", gridX, gridY)
}

// A* Node for Time-Windowed Grid Search
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

// Time-Windowed Reservation-Table A* Path Planner
func (rt *ReservationTable) PlanPath(start, target Point, startTimeMs int64, robotID string) []Point {
	openPQ := &PriorityQueue{}
	heap.Init(openPQ)

	startNode := &AStarNode{
		X:      math.Round(start.X),
		Y:      math.Round(start.Y),
		GCost:  0,
		HCost:  math.Hypot(target.X-start.X, target.Y-start.Y),
		FCost:  math.Hypot(target.X-start.X, target.Y-start.Y),
		TimeMs: startTimeMs,
	}
	heap.Push(openPQ, startNode)

	visited := make(map[string]bool)

	// Directions: Right, Left, Down, Up, Wait
	dx := []float64{1, -1, 0, 0, 0}
	dy := []float64{0, 0, 1, -1, 0}

	for openPQ.Len() > 0 {
		current := heap.Pop(openPQ).(*AStarNode)

		// Reached target
		if math.Hypot(current.X-target.X, current.Y-target.Y) < 0.8 {
			path := []Point{}
			curr := current
			for curr != nil {
				path = append([]Point{{X: curr.X, Y: curr.Y}}, path...)
				curr = curr.Parent
			}
			return path
		}

		key := fmt.Sprintf("%d_%d_%d", int(current.X), int(current.Y), current.TimeMs/1000)
		if visited[key] {
			continue
		}
		visited[key] = true

		for i := 0; i < 5; i++ {
			nextX := math.Max(0, math.Min(10, current.X+dx[i]))
			nextY := math.Max(0, math.Min(10, current.Y+dy[i]))
			nextTime := current.TimeMs + 500 // 500ms per step

			if !rt.IsCellAvailable(nextX, nextY, nextTime, robotID) {
				continue
			}

			g := current.GCost + 0.5
			if dx[i] == 0 && dy[i] == 0 {
				g += 0.2 // Small penalty for waiting
			}
			h := math.Hypot(target.X-nextX, target.Y-nextY)

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

	// Fallback straight path if search cap reached
	return []Point{{X: math.Round(start.X), Y: math.Round(start.Y)}, {X: math.Round(target.X), Y: math.Round(target.Y)}}
}
