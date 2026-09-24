package node

import (
	"math"
	"sync"
)

type Task struct {
	ID         string `json:"id"`
	Pickup     Point  `json:"pickup"`
	Dropoff    Point  `json:"dropoff"`
	Status     string `json:"status"` // "UNASSIGNED", "ASSIGNED", "COMPLETED"
	AssignedTo string `json:"assigned_to"`
}

type AuctionEngine struct {
	mu        sync.RWMutex
	tasks     map[string]*Task
	myRobotID string
}

func NewAuctionEngine(robotID string) *AuctionEngine {
	return &AuctionEngine{
		tasks:     make(map[string]*Task),
		myRobotID: robotID,
	}
}

// ComputeBid calculates a cost bid based on distance + battery overhead
func (ae *AuctionEngine) ComputeBid(task Task, currentPos Point, batteryPct float64) float64 {
	if batteryPct < 15.0 {
		return math.Inf(1) // Refuse tasks if battery is critically low
	}

	distToPickup := math.Hypot(task.Pickup.X-currentPos.X, task.Pickup.Y-currentPos.Y)
	distPickupToDrop := math.Hypot(task.Dropoff.X-task.Pickup.X, task.Dropoff.Y-task.Pickup.Y)

	totalDistance := distToPickup + distPickupToDrop
	batteryFactor := (100.0 - batteryPct) * 0.05 // Small penalty for lower battery

	return totalDistance + batteryFactor
}

func (ae *AuctionEngine) RegisterTask(task Task) {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	ae.tasks[task.ID] = &task
}
