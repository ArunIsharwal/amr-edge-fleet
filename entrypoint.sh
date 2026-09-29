#!/bin/sh
set -e

COUNT=${COUNT:-4}
echo "=========================================================="
echo "🤖 Starting SIH AMR Fleet — $COUNT P2P Nodes + Nginx Gateway"
echo "=========================================================="

cleanup() {
    echo "🛑 Stopping all Go AMR nodes..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

for i in $(seq 1 $COUNT); do
    port=$((8080 + i))
    id=$(printf "AMR-%02d" $i)
    echo "🚀 Spawning $id on port $port..."
    /app/amr-fleet --port=$port --id=$id &
done

sleep 1

echo "🌐 Starting Nginx Gateway on port 8080..."
exec nginx -g "daemon off;"
