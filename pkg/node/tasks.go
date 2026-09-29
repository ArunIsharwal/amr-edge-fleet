package node

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

type Task struct {
	ID         string `json:"id"`
	Pickup     Point  `json:"pickup"`
	Dropoff    Point  `json:"dropoff"`
	Priority   int    `json:"priority"` // 100 = CRITICAL, 75 = HIGH, 50 = NORMAL, 25 = LOW
	Status     string `json:"status"`   // "UNASSIGNED", "NAVIGATING_PICKUP", "DELIVERING", "COMPLETED"
	AssignedTo string `json:"assigned_to"`
	CreatedAt  int64  `json:"created_at_ms"`
}

type TaskManager struct {
	mu    sync.RWMutex
	tasks map[string]*Task
}

func NewTaskManager() *TaskManager {
	tm := &TaskManager{
		tasks: make(map[string]*Task),
	}
	tm.LoadTasksFromFile("tasks.json")
	return tm
}

func (tm *TaskManager) LoadTasksFromFile(filePath string) {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return
	}
	var loadedTasks []Task
	if err := json.Unmarshal(file, &loadedTasks); err == nil {
		tm.mu.Lock()
		defer tm.mu.Unlock()
		for _, t := range loadedTasks {
			if t.CreatedAt == 0 {
				t.CreatedAt = time.Now().UnixMilli()
			}
			tCopy := t
			tm.tasks[t.ID] = &tCopy
		}
	}
}

func (tm *TaskManager) AddOrUpdateTask(task Task) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if task.CreatedAt == 0 {
		task.CreatedAt = time.Now().UnixMilli()
	}
	tm.tasks[task.ID] = &task
}

func (tm *TaskManager) GetTask(id string) (*Task, bool) {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	t, found := tm.tasks[id]
	if !found {
		return nil, false
	}
	tCopy := *t
	return &tCopy, true
}

func (tm *TaskManager) GetAllTasks() []Task {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	unassignedCount := 0
	for _, t := range tm.tasks {
		if t.Status == "UNASSIGNED" {
			unassignedCount++
		}
	}

	// Auto-recycle completed tasks back to UNASSIGNED so the demo queue never depletes
	if unassignedCount < 3 {
		for _, t := range tm.tasks {
			if t.Status == "COMPLETED" {
				t.Status = "UNASSIGNED"
				t.AssignedTo = ""
				t.CreatedAt = time.Now().UnixMilli()
			}
		}
	}

	list := make([]Task, 0, len(tm.tasks))
	for _, t := range tm.tasks {
		list = append(list, *t)
	}
	return list
}
