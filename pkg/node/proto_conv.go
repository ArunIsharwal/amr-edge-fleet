package node

import (
	v1 "sih-amr-fleet/pkg/proto/fleet/v1"
)

func PointToProto(p Point) *v1.Point {
	return &v1.Point{X: p.X, Y: p.Y}
}

func PointFromProto(p *v1.Point) Point {
	if p == nil {
		return Point{}
	}
	return Point{X: p.GetX(), Y: p.GetY()}
}

func PositionToProto(p Position) *v1.Position {
	return &v1.Position{
		X:           p.X,
		Y:           p.Y,
		TimestampMs: p.TimestampMs,
	}
}

func PositionFromProto(p *v1.Position) Position {
	if p == nil {
		return Position{}
	}
	return Position{
		X:           p.GetX(),
		Y:           p.GetY(),
		TimestampMs: p.GetTimestampMs(),
	}
}

func TaskToProto(t *Task) *v1.Task {
	if t == nil {
		return nil
	}
	return &v1.Task{
		Id:         t.ID,
		Pickup:     PointToProto(t.Pickup),
		Dropoff:    PointToProto(t.Dropoff),
		Priority:   int32(t.Priority),
		CreatedAt:  t.CreatedAt,
		Status:     t.Status,
		AssignedTo: t.AssignedTo,
	}
}

func TaskFromProto(t *v1.Task) *Task {
	if t == nil {
		return nil
	}
	return &Task{
		ID:         t.GetId(),
		Pickup:     PointFromProto(t.GetPickup()),
		Dropoff:    PointFromProto(t.GetDropoff()),
		Priority:   int(t.GetPriority()),
		CreatedAt:  t.GetCreatedAt(),
		Status:     t.GetStatus(),
		AssignedTo: t.GetAssignedTo(),
	}
}

func RobotStateToProto(s RobotState) *v1.RobotState {
	hist := make([]*v1.Position, len(s.History))
	for i, h := range s.History {
		hist[i] = PositionToProto(h)
	}

	path := make([]*v1.Point, len(s.Path))
	for i, p := range s.Path {
		path[i] = PointToProto(p)
	}

	return &v1.RobotState{
		RobotId:         s.RobotID,
		CurrentPos:      PositionToProto(s.CurrentPos),
		History:         hist,
		IntendedPos:     PositionToProto(s.IntendedPos),
		TargetPos:       PositionToProto(s.TargetPos),
		BatteryPct:      s.BatteryPct,
		Status:          s.Status,
		CurrentTask:     TaskToProto(s.CurrentTask),
		TasksCompleted:  int32(s.TasksCompleted),
		Path:            path,
		PriorityScore:   int32(s.PriorityScore),
		LastHeartbeatMs: s.LastHeartbeatMs,
		IsOnline:        s.IsOnline,
	}
}

func RobotStateFromProto(s *v1.RobotState) RobotState {
	if s == nil {
		return RobotState{}
	}

	hist := make([]Position, len(s.GetHistory()))
	for i, h := range s.GetHistory() {
		hist[i] = PositionFromProto(h)
	}

	path := make([]Point, len(s.GetPath()))
	for i, p := range s.GetPath() {
		path[i] = PointFromProto(p)
	}

	return RobotState{
		RobotID:         s.GetRobotId(),
		CurrentPos:      PositionFromProto(s.GetCurrentPos()),
		History:         hist,
		IntendedPos:     PositionFromProto(s.GetIntendedPos()),
		TargetPos:       PositionFromProto(s.GetTargetPos()),
		BatteryPct:      s.GetBatteryPct(),
		Status:          s.GetStatus(),
		CurrentTask:     TaskFromProto(s.GetCurrentTask()),
		TasksCompleted:  int(s.GetTasksCompleted()),
		Path:            path,
		PriorityScore:   int(s.GetPriorityScore()),
		LastHeartbeatMs: s.GetLastHeartbeatMs(),
		IsOnline:        s.GetIsOnline(),
	}
}
