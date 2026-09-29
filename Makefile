.PHONY: dev build build-arm run-demo run-nodes-only web-only help kill-nodes

# Default target
all: build

# Number of Go nodes to launch (default: 4, can override with COUNT=6 or COUNT=10)
COUNT ?= 4

# ─── Run Dev: Vite HMR frontend + 4 Go P2P AMR nodes ───────────────────
dev: build
	@echo "🔥 Starting SIH AMR Fleet Dev (Vite + $(COUNT) Go P2P Nodes)..."
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
	@echo "🚀 Spawning $(COUNT) AMR P2P Edge Nodes on ports 8081..$(shell expr 8080 + $(COUNT))..."
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
	@pkill -x amr-fleet || true
	@echo "✅ All nodes killed."

# ─── Production Build: Vite embed → standalone Go binary ───────────────────────
build:
	@echo "📦 Building Production Standalone Binary..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@go build -ldflags="-s -w" -o bin/amr-fleet main.go
	@echo "✅ Production Binary: ./bin/amr-fleet"

# ─── ARM64 Cross-Compilation for Raspberry Pi / Jetson Nano ────────────────────
build-arm:
	@echo "🦿 Cross-compiling ARM64 for Raspberry Pi / Jetson Nano..."
	@mkdir -p web/dist
	@cd web && npm run build
	@mkdir -p bin
	@GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o bin/amr-fleet-arm64 main.go
	@echo "✅ ARM64 Binary: ./bin/amr-fleet-arm64"

# ─── 4-node demo (background processes) ────────────────────────────────────────
run-demo: run-nodes-only

help:
	@echo "SIH AMR Fleet — Edge-AI Distributed Fleet Coordination"
	@echo ""
	@echo "  make dev           — Full dev: Vite + 4 Go P2P nodes (recommended)"
	@echo "  make run-nodes-only— Launch Go nodes (default COUNT=4, e.g. COUNT=6)"
	@echo "  make kill-nodes    — Kill all running Go nodes"
	@echo "  make build         — Production binary (embedded UI)"
	@echo "  make build-arm     — ARM64 binary for Raspberry Pi/Jetson Nano"
