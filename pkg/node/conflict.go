package node

import (
	"math"
)

type ConflictSolver struct{}

func NewConflictSolver() *ConflictSolver {
	return &ConflictSolver{}
}

// CheckProximityConflict evaluates if two robots are in immediate collision trajectory
func (cs *ConflictSolver) CheckProximityConflict(
	myID string, myNextX, myNextY float64,
	peerID string, peerNextX, peerNextY float64,
) (shouldYield bool, reason string) {
	dist := math.Hypot(myNextX-peerNextX, myNextY-peerNextY)

	// Threshold: 1.5 meters proximity
	if dist < 1.5 {
		// Priority Rule: Lower alphanumeric ID passes first, higher ID yields
		if myID > peerID {
			return true, "PROXIMITY_YIELD_TO_" + peerID
		}
	}
	return false, ""
}
