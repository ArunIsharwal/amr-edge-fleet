package node

import (
	"sync"
	"time"
)

type MetricsEngine struct {
	mu                  sync.RWMutex
	CollisionCount      int           `json:"collision_count"`
	TaskCompletionTimes []float64     `json:"task_completion_times_sec"`
	CurrentMode         string        `json:"current_mode"` // "COORDINATION" or "BASELINE_STOP_WAIT"
	TotalTasksDone      int           `json:"total_tasks_done"`
	StartTime           time.Time     `json:"start_time"`
}

func NewMetricsEngine() *MetricsEngine {
	return &MetricsEngine{
		CollisionCount:      0,
		TaskCompletionTimes: make([]float64, 0),
		CurrentMode:         "COORDINATION",
		StartTime:           time.Now(),
	}
}

func (me *MetricsEngine) RecordCollision() {
	me.mu.Lock()
	defer me.mu.Unlock()
	me.CollisionCount++
}

func (me *MetricsEngine) RecordTaskDone(durationSec float64) {
	me.mu.Lock()
	defer me.mu.Unlock()
	me.TaskCompletionTimes = append(me.TaskCompletionTimes, durationSec)
	me.TotalTasksDone++
}

func (me *MetricsEngine) SetMode(mode string) {
	me.mu.Lock()
	defer me.mu.Unlock()
	me.CurrentMode = mode
}

func (me *MetricsEngine) GetAverageTaskTime() float64 {
	me.mu.RLock()
	defer me.mu.RUnlock()
	if len(me.TaskCompletionTimes) == 0 {
		return 0.0
	}
	sum := 0.0
	for _, t := range me.TaskCompletionTimes {
		sum += t
	}
	return sum / float64(len(me.TaskCompletionTimes))
}
