.PHONY: dev dev-local build build-arm run-demo run-nodes-only web-only help kill-nodes docker-build docker-run docker-stop

# Default target
all: build

# Number of Go nodes to launch (default: 4, can override with COUNT=6 or COUNT=10)
COUNT ?= 4

# ─── Run Dev: Docker Container (Go Nodes + Gateway :8080) + Vite on Host ──────
dev:
	@echo "📦 [1/4] Compiling Go backend binary..."
	@mkdir -p bin
	@CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/amr-fleet main.go
	@echo "🐳 [2/4] Building backend Docker image (Go Nodes + Nginx Gateway)..."
	@docker build -t amr-fleet:latest .
	@echo "🛑 [3/4] Cleaning up any old container..."
	@docker stop amr-fleet 2>/dev/null || true
	@docker rm amr-fleet 2>/dev/null || true
	@echo "🚀 [4/4] Starting amr-fleet container on port 8080 (COUNT=$(COUNT))..."
	@docker run -d --name amr-fleet -e COUNT=$(COUNT) -p 8080:8080 amr-fleet:latest
	@echo "✅ Backend Gateway active on http://localhost:8080"
	@echo "🌐 Launching Vite frontend on host..."
	@bash -c 'trap "echo \"\n🛑 Stopping Docker backend...\"; docker stop amr-fleet; docker rm amr-fleet 2>/dev/null; exit 0" SIGINT SIGTERM EXIT; \
		cd web && npm run dev'

# ─── Run Dev purely on host without Docker (Alternative) ─────────────────────
dev-local: build
	@echo "🔥 Starting SIH AMR Fleet Dev on Host (Vite + $(COUNT) Go P2P Nodes)..."
	@trap '$(MAKE) kill-nodes' EXIT INT TERM; \
	for i in $$(seq 1 $(COUNT)); do \
		port=$$((8080 + i)); \
		id=AMR-$$(printf "%02d" $$i); \
		echo "🚀 Spawning node $$id on port $$port..."; \
		nohup ./bin/amr-fleet --port=$$port --id=$$id >/dev/null 2>&1 & \
	done; \
	cd web && npm run dev

# ─── Run Go P2P nodes (default 4, configurable via COUNT=N) ───────────
run-nodes-only: build
	@echo "🚀 Spawning $(COUNT) AMR P2P Edge Nodes on ports 8081..$$(expr 8080 + $(COUNT))..."
	@for i in $$(seq 1 $(COUNT)); do \
		port=$$((8080 + i)); \
		id=AMR-$$(printf "%02d" $$i); \
		nohup ./bin/amr-fleet --port=$$port --id=$$id >/dev/null 2>&1 & \
	done
	@echo "✅ $(COUNT) AMR Nodes Active! (kill with: make kill-nodes)"

# ─── Run only Vite frontend ─────────────────────────────────────────────
web-only:
	@echo "🌐 Starting Vite frontend..."
	@cd web && npm run dev

# ─── Kill all running Go AMR nodes ─────────────────────────────────────────────
kill-nodes:
	@echo "🛑 Killing all AMR Go nodes..."
	@pkill -f "amr-fleet" 2>/dev/null || true
	@fuser -k -9 8081/tcp 8082/tcp 8083/tcp 8084/tcp 2>/dev/null || true
	@echo "✅ All nodes killed."

# ─── Production Build: Vite embed → standalone Go binary ───────────────────────
build:
	@echo "📦 Building Production Standalone Binary..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/amr-fleet main.go
	@echo "✅ Production Binary: ./bin/amr-fleet"

# ─── ARM64 Cross-Compilation for Raspberry Pi / Jetson Nano ────────────────────
build-arm:
	@echo "🦿 Cross-compiling ARM64 for Raspberry Pi / Jetson Nano..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o bin/amr-fleet-arm64 main.go
	@echo "✅ ARM64 Binary: ./bin/amr-fleet-arm64"

# ─── Docker Container: Go Nodes + Nginx Gateway on :8080 ──────────────────────
docker-build:
	@echo "📦 Compiling Go backend binary..."
	@mkdir -p bin
	@CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/amr-fleet main.go
	@echo "🐳 Building Docker Image (Go Nodes + Nginx Gateway :8080)..."
	@docker build -t amr-fleet:latest .
	@echo "✅ Docker Image Built: amr-fleet:latest"

docker-run:
	@echo "🚀 Running amr-fleet container on port 8080 (COUNT=$(COUNT))..."
	@docker run -d --name amr-fleet -e COUNT=$(COUNT) -p 8080:8080 amr-fleet:latest
	@echo "✅ Gateway active on http://localhost:8080"
	@echo "   Check health: curl http://localhost:8080/health"

docker-stop:
	@echo "🛑 Stopping amr-fleet container..."
	@docker stop amr-fleet 2>/dev/null || true
	@docker rm amr-fleet 2>/dev/null || true
	@echo "✅ Container stopped and removed."

help:
	@echo "SIH AMR Fleet — Edge-AI Distributed Fleet Coordination"
	@echo ""
	@echo "  make dev           — Docker Container (Backend) + Vite on Host (recommended)"
	@echo "  make dev-local     — Run everything directly on host without Docker"
	@echo "  make run-nodes-only— Spawn Go nodes in background"
	@echo "  make kill-nodes    — Kill all running Go nodes"
	@echo "  make docker-build  — Build Docker container"
	@echo "  make docker-run    — Run Docker container on :8080"
	@echo "  make docker-stop   — Stop Docker container"
	@echo "  make build         — Production binary (embedded UI)"
