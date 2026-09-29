package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"embed"
	"flag"
	"io/fs"
	"log"
	"math"
	"math/big"
	mathrand "math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/quic-go/quic-go/http3"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"sih-amr-fleet/pkg/node"
	"sih-amr-fleet/pkg/proto/fleet/v1/fleetv1connect"
)

// Embedded Vite React UI static files for single-binary production build
//
//go:embed all:web/dist
var webDist embed.FS

func generateSelfSignedCert() tls.Certificate {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatalf("Failed to generate ECDSA key for QUIC: %v", err)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("0.0.0.0")},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		log.Fatalf("Failed to create certificate for QUIC: %v", err)
	}

	return tls.Certificate{
		Certificate: [][]byte{derBytes},
		PrivateKey:  priv,
	}
}

// Preset start positions in open corridors (18m x 10m grid) to prevent overlap on spawn
var PresetPositions = map[string]node.Point{
	"AMR-01": {X: 1.0, Y: 1.0},
	"AMR-02": {X: 16.5, Y: 1.0},
	"AMR-03": {X: 1.0, Y: 9.0},
	"AMR-04": {X: 16.5, Y: 9.0},
	"AMR-05": {X: 6.0, Y: 1.0},
	"AMR-06": {X: 11.0, Y: 1.0},
	"AMR-07": {X: 6.0, Y: 9.0},
	"AMR-08": {X: 11.0, Y: 9.0},
	"AMR-09": {X: 1.0, Y: 5.0},
	"AMR-10": {X: 16.5, Y: 5.0},
}

func main() {
	mathrand.Seed(time.Now().UnixNano())

	port := flag.String("port", "8081", "Node HTTP/RPC Port")
	id := flag.String("id", "AMR-01", "Robot ID")
	peersFlag := flag.String("peers", "", "Comma-separated list of peer node addresses")
	flag.Parse()

	peers := []string{}
	if *peersFlag != "" {
		peers = strings.Split(*peersFlag, ",")
	} else {
		// Default peer discovery range: ports 8081 through 8090
		for p := 8081; p <= 8090; p++ {
			pStr := strconv.Itoa(p)
			if pStr != *port {
				peers = append(peers, "http://localhost:"+pStr)
			}
		}
	}

	startPos, found := PresetPositions[*id]
	if !found {
		pNum, _ := strconv.Atoi(*port)
		offset := (pNum - 8081) % 10
		startPos = node.Point{
			X: math.Max(1.0, math.Min(16.5, float64((offset*3)%17)+1.0)),
			Y: math.Max(1.0, math.Min(9.0, float64((offset*2)%9)+1.0)),
		}
	}

	amrNode := node.NewRobotNode(*id, startPos.X, startPos.Y, peers)

	// Start P2P Sync background engine over QUIC
	go amrNode.StartP2PSyncLoop()

	mux := http.NewServeMux()

	// Register ConnectRPC FleetService Handler (/fleet.v1.FleetService/)
	fleetServer := node.NewFleetServiceServer(amrNode)
	path, connectHandler := fleetv1connect.NewFleetServiceHandler(fleetServer)
	mux.Handle(path, connectHandler)

	// Legacy REST / JSON fallback endpoints
	mux.HandleFunc("/api/sync", amrNode.HandleSyncState)
	mux.HandleFunc("/api/status", amrNode.HandleGetRobotStatus)
	mux.HandleFunc("/api/toggle", amrNode.HandleToggleOnline)
	mux.HandleFunc("/api/metrics", amrNode.HandleGetMetrics)
	mux.HandleFunc("/api/task", amrNode.HandleAssignTask)
	mux.HandleFunc("/api/tasks", amrNode.HandleGetTasks)

	// Embedded Vite React UI Static Handler
	distSubFS, err := fs.Sub(webDist, "web/dist")
	if err == nil {
		mux.Handle("/", http.FileServer(http.FS(distSubFS)))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<h2>sih-amr-fleet Edge Node ` + *id + ` Active</h2><p>ConnectRPC over HTTP/3 QUIC online on port :` + *port + `</p>`))
		})
	}

	// CORS Middleware for ConnectRPC Web client (@connectrpc/connect-web)
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		ExposedHeaders:   []string{"Connect-Accept-Encoding", "Connect-Content-Encoding"},
		AllowCredentials: true,
	}).Handler(mux)

	// Start quic-go HTTP/3 UDP Server for P2P inter-robot mesh
	go func() {
		cert := generateSelfSignedCert()
		quicServer := &http3.Server{
			Addr:    ":" + *port,
			Handler: corsHandler,
			TLSConfig: &tls.Config{
				Certificates: []tls.Certificate{cert},
			},
		}
		log.Printf("⚡ [%s] quic-go HTTP/3 UDP P2P Engine listening on :%s", *id, *port)
		if err := quicServer.ListenAndServe(); err != nil {
			log.Printf("QUIC server error: %v", err)
		}
	}()

	log.Printf("🚀 [%s] Edge AMR Node listening on :%s (ConnectRPC over HTTP/2 & quic-go HTTP/3)", *id, *port)
	log.Printf("📡 Connected P2P Peers: %d nodes registered", len(peers))

	h2Server := &http2.Server{}
	err = http.ListenAndServe(":"+*port, h2c.NewHandler(corsHandler, h2Server))
	if err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
