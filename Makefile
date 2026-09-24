.PHONY: dev build build-arm run-demo run-nodes-only web-only help kill-nodes

# Default target
all: build

# ─── Run Dev: Vite HMR frontend + all 3 Go P2P AMR nodes ───────────────────
dev:
	@echo "🔥 Starting Full SIH AMR Fleet Dev (Vite + 3 Go P2P Nodes)..."
	@npx concurrently --kill-others \
		"cd web && npm run dev" \
		"go run main.go --port=8081 --id=AMR-01" \
		"go run main.go --port=8082 --id=AMR-02" \
		"go run main.go --port=8083 --id=AMR-03"

# ─── Run only the 3 Go P2P nodes (if you want Vite running separately) ───────
run-nodes-only:
	@echo "🚀 Spawning 3 AMR P2P Edge Nodes on ports 8081, 8082, 8083..."
	@go run main.go --port=8081 --id=AMR-01 &
	@go run main.go --port=8082 --id=AMR-02 &
	@go run main.go --port=8083 --id=AMR-03 &
	@echo "✅ 3 AMR Nodes Active! (kill with: make kill-nodes)"

# ─── Run only Vite frontend (client-side simulation mode) ─────────────────────
web-only:
	@echo "🌐 Starting Vite frontend (client-side simulation — no Go nodes needed)..."
	@cd web && npm run dev

# ─── Kill all running Go AMR nodes ─────────────────────────────────────────────
kill-nodes:
	@echo "🛑 Killing all AMR Go nodes..."
	@pkill -f "main.go --port=808" || true
	@pkill -f "amr-fleet" || true
	@echo "✅ All nodes killed."

# ─── Production Build: Vite embed → standalone Go binary ───────────────────────
build:
	@echo "📦 Building Production Standalone Binary..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@go build -ldflags="-s -w" -o bin/amr-fleet main.go
	@echo "✅ Production Binary: ./bin/amr-fleet"
	@echo "   Run single node: ./bin/amr-fleet --port=8081 --id=AMR-01"

# ─── ARM64 Cross-Compilation for Raspberry Pi / Jetson Nano ────────────────────
build-arm:
	@echo "🦿 Cross-compiling ARM64 for Raspberry Pi / Jetson Nano..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o bin/amr-fleet-arm64 main.go
	@echo "✅ ARM64 Binary: ./bin/amr-fleet-arm64"

# ─── Original 3-node demo (background processes) ───────────────────────────────
run-demo:
	@echo "🚀 Spawning 3 Edge AMR Nodes on ports 8081, 8082, 8083..."
	@go run main.go --port=8081 --id=AMR-01 &
	@go run main.go --port=8082 --id=AMR-02 &
	@go run main.go --port=8083 --id=AMR-03 &
	@echo "✅ 3 AMR Nodes Active in P2P Mesh!"

help:
	@echo "SIH AMR Fleet — Edge-AI Distributed Fleet Coordination"
	@echo ""
	@echo "  make dev           — Full dev: Vite + 3 Go P2P nodes (recommended)"
	@echo "  make web-only      — Frontend only (client-side simulation, no Go)"
	@echo "  make run-nodes-only— 3 Go nodes only (run Vite separately)"
	@echo "  make kill-nodes    — Kill all running Go nodes"
	@echo "  make build         — Production binary (embedded UI)"
	@echo "  make build-arm     — ARM64 binary for Raspberry Pi/Jetson Nano"
