package node

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"log"
	"math"
	"net/http"
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

// ConnectRPC HTTP Handler Methods
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

	r.mu.Lock()
	defer r.mu.Unlock()

	// --- P2P Conflict Resolution (MAPF-style priority) ---
	// Compute distance between current intended positions
	dist := math.Hypot(r.IntendedX-sender.IntendedPos.X, r.IntendedY-sender.IntendedPos.Y)
	distCurrent := math.Hypot(r.CurrentX-sender.CurrentPos.X, r.CurrentY-sender.CurrentPos.Y)

	yieldAck := false

	// Proximity conflict zone — higher alphanumeric ID yields
	if (dist < 1.8 || distCurrent < 1.2) && r.Status == "MOVING" {
		if r.ID > sender.RobotID { // Higher alphanumeric ID yields
			r.Status = "YIELDING"
			r.IsYielding = true
			r.YieldTicksLeft = 4 // yield for 4 ticks (~800ms)
			yieldAck = true
			r.Metrics.RecordCollision() // Potential collision averted
			log.Printf("🛑 [%s] YIELDING to %s (dist=%.2f)", r.ID, sender.RobotID, dist)
		}
	} else if r.Status == "YIELDING" && distCurrent > 2.0 {
		// Path cleared — resume
		r.Status = "MOVING"
		r.IsYielding = false
		r.YieldTicksLeft = 0
	}

	snap := RobotState{
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
		CurrentTaskID:   r.CurrentTaskID,
		TasksCompleted:  r.TasksCompleted,
		LastHeartbeatMs: time.Now().UnixMilli(),
	}

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
	defer r.mu.Unlock()

	if payload.BlockAisle {
		r.ReservationTable.SetAisleBlocked(payload.BlockedX, payload.BlockedY, true)
		r.Status = "REPLANNING"
		// Re-route: pick a waypoint that avoids the blocked aisle
		r.PickNextWaypointAvoiding(payload.BlockedX, payload.BlockedY)
		log.Printf("⚠️  [%s] REPLANNING around blocked aisle at (%.1f, %.1f)", r.ID, payload.BlockedX, payload.BlockedY)
	} else {
		r.IsOnline = payload.Enable
		if !r.IsOnline {
			r.Status = "OFFLINE_SIMULATED"
			log.Printf("🛑 [%s] Node KILLED via UI", r.ID)
		} else {
			r.Status = "MOVING"
			r.Battery = 98.0 // Restore battery on re-enable
			log.Printf("⚡ [%s] Node RE-ENABLED via UI", r.ID)
		}
	}

	if payload.Mode != "" {
		r.Metrics.SetMode(payload.Mode)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// PickNextWaypointAvoiding picks a waypoint far from a blocked position
func (r *RobotNode) PickNextWaypointAvoiding(blockedX, blockedY float64) {
	bestIdx := -1
	bestScore := -1.0
	for i, wp := range WarehouseWaypoints {
		distToBlocked := math.Hypot(wp.X-blockedX, wp.Y-blockedY)
		distToSelf := math.Hypot(wp.X-r.CurrentX, wp.Y-r.CurrentY)
		// Prefer waypoints far from blocked aisle and reasonably close to robot
		score := distToBlocked - distToSelf*0.3
		if score > bestScore && distToSelf > 1.0 {
			bestScore = score
			bestIdx = i
		}
	}
	if bestIdx >= 0 {
		r.WaypointIdx = bestIdx
		r.TargetX = WarehouseWaypoints[bestIdx].X
		r.TargetY = WarehouseWaypoints[bestIdx].Y
	}
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

// StartP2PSyncLoop runs the main simulation loop: physics + P2P peer gossip
func (r *RobotNode) StartP2PSyncLoop() {
	// quic-go HTTP/3 transport for inter-robot P2P UDP gossip
	quicRoundTripper := &http3.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	quicClient := &http.Client{
		Transport: quicRoundTripper,
		Timeout:   150 * time.Millisecond,
	}

	// Fallback HTTP/2 client
	stdClient := &http.Client{Timeout: 150 * time.Millisecond}

	// Physics simulation runs at 200ms ticks
	physicsTicker := time.NewTicker(200 * time.Millisecond)
	// P2P sync runs at 300ms
	syncTicker := time.NewTicker(300 * time.Millisecond)

	for {
		select {
		case <-physicsTicker.C:
			// Step the physics simulation forward
			r.StepSimulation()

		case <-syncTicker.C:
			r.mu.RLock()
			online := r.IsOnline
			r.mu.RUnlock()

			if !online {
				continue
			}

			// Gossip state to all peers concurrently
			snap := r.GetSnapshot()
			for _, peerAddr := range r.Peers {
				go func(peer string, s RobotState) {
					payload := SyncPayload{Sender: s}
					body, _ := json.Marshal(payload)
					req, err := http.NewRequest("POST", peer+"/api/sync", bytes.NewReader(body))
					if err != nil {
						return
					}
					req.Header.Set("Content-Type", "application/json")

					// Try QUIC first, fallback to HTTP/2
					resp, err := quicClient.Do(req)
					if err != nil {
						req2, _ := http.NewRequest("POST", peer+"/api/sync", bytes.NewReader(body))
						req2.Header.Set("Content-Type", "application/json")
						resp, err = stdClient.Do(req2)
						if err != nil {
							return
						}
					}
					defer resp.Body.Close()

					// Parse sync response — peer may instruct us to adjust
					var syncResp SyncResponsePayload
					if err := json.NewDecoder(resp.Body).Decode(&syncResp); err == nil {
						if syncResp.YieldAcknowledged {
							log.Printf("✅ [%s] Peer %s acknowledged yield", r.ID, syncResp.Receiver.RobotID)
						}
					}
				}(peerAddr, snap)
			}
		}
	}
}
