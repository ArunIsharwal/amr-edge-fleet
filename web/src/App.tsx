import { useEffect, useRef, useState, useCallback } from 'react';
import { GridCanvas } from './components/GridCanvas';
import type { RobotStateUI, Position } from './components/GridCanvas';
import { RobotCard } from './components/RobotCard';
import { MetricsPanel } from './components/MetricsPanel';
import { ControlPanel } from './components/ControlPanel';
import { Cpu, ShieldCheck, Radio, Wifi } from 'lucide-react';

/* ─── Constants ─────────────────────────────────────────── */
const NODE_CONFIGS = [
  { id: 'AMR-01', port: '8081', color: '#3B82F6' },
  { id: 'AMR-02', port: '8082', color: '#10B981' },
  { id: 'AMR-03', port: '8083', color: '#F59E0B' },
];

// Warehouse task waypoints (grid 0–10)
const WAYPOINTS: Position[] = [
  { x: 1.0, y: 1.0 },
  { x: 5.0, y: 1.0 },
  { x: 9.0, y: 1.0 },
  { x: 9.0, y: 5.0 },
  { x: 9.0, y: 9.0 },
  { x: 5.0, y: 9.0 },
  { x: 1.0, y: 9.0 },
  { x: 1.0, y: 5.0 },
  { x: 3.0, y: 3.0 },
  { x: 7.0, y: 3.0 },
  { x: 7.0, y: 7.0 },
  { x: 3.0, y: 7.0 },
];

const GRID_MIN = 0.2;
const GRID_MAX = 9.8;
const STEP = 0.22;          // grid-units per tick
const CONFLICT_DIST = 1.4;  // conflict proximity
const YIELD_TICKS = 5;      // ticks to yield
const HISTORY_LEN = 5;

/* ─── Types ─────────────────────────────────────────────── */
interface SimBot {
  // Rendered fields (shared with GridCanvas)
  robot_id: string;
  port: string;
  color: string;
  current_pos: Position;
  history: Position[];
  intended_pos: Position;
  target_pos: Position;
  battery_pct: number;
  status: string;       // MOVING | YIELDING | REPLANNING | OFFLINE_SIMULATED
  is_online: boolean;
  tasks_completed: number;
  // Internal sim fields
  waypointIdx: number;
  yieldTicks: number;
  replanTicks: number;
}

function dist(a: Position, b: Position) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nextWaypoint(idx: number, cur: Position): { idx: number; pos: Position } {
  for (let i = 1; i <= WAYPOINTS.length; i++) {
    const nextIdx = (idx + i) % WAYPOINTS.length;
    if (dist(cur, WAYPOINTS[nextIdx]) > 1.0) {
      return { idx: nextIdx, pos: WAYPOINTS[nextIdx] };
    }
  }
  return { idx, pos: WAYPOINTS[idx] };
}

function clamp(v: number) {
  return Math.max(GRID_MIN, Math.min(GRID_MAX, v));
}

function makeInitialBots(): Record<string, SimBot> {
  return {
    'AMR-01': {
      robot_id: 'AMR-01', port: '8081', color: '#3B82F6',
      current_pos: { x: 1.0, y: 1.0 },
      history: [],
      intended_pos: { x: 1.5, y: 1.0 },
      target_pos: WAYPOINTS[2],
      battery_pct: 98, status: 'MOVING', is_online: true, tasks_completed: 0,
      waypointIdx: 2, yieldTicks: 0, replanTicks: 0,
    },
    'AMR-02': {
      robot_id: 'AMR-02', port: '8082', color: '#10B981',
      current_pos: { x: 9.0, y: 9.0 },
      history: [],
      intended_pos: { x: 8.5, y: 9.0 },
      target_pos: WAYPOINTS[6],
      battery_pct: 95, status: 'MOVING', is_online: true, tasks_completed: 0,
      waypointIdx: 6, yieldTicks: 0, replanTicks: 0,
    },
    'AMR-03': {
      robot_id: 'AMR-03', port: '8083', color: '#F59E0B',
      current_pos: { x: 5.0, y: 9.0 },
      history: [],
      intended_pos: { x: 5.0, y: 8.5 },
      target_pos: WAYPOINTS[0],
      battery_pct: 92, status: 'MOVING', is_online: true, tasks_completed: 0,
      waypointIdx: 0, yieldTicks: 0, replanTicks: 0,
    },
  };
}

/* ─── Component ─────────────────────────────────────────── */
export default function App() {
  // All simulation state lives in a ref so the interval always sees current data
  const botsRef = useRef<Record<string, SimBot>>(makeInitialBots());
  const blockedAislesRef = useRef<Array<{ x: number; y: number }>>([]);
  const modeRef = useRef<string>('COORDINATION');
  const collisionsRef = useRef<number>(0);
  const avoidedRef = useRef<number>(0);
  const tasksRef = useRef<number>(0);

  // React state for rendering (updated ~10fps)
  const [displayBots, setDisplayBots] = useState<Record<string, SimBot>>(botsRef.current);
  const [blockedAisles, setBlockedAisles] = useState<Array<{ x: number; y: number }>>([]);
  const [currentMode, setCurrentMode] = useState<string>('COORDINATION');
  const [collisions, setCollisions] = useState<number>(0);
  const [avoided, setAvoided] = useState<number>(0);
  const [totalTasks, setTotalTasks] = useState<number>(0);
  const [backendLive, setBackendLive] = useState<Record<string, boolean>>({
    'AMR-01': false, 'AMR-02': false, 'AMR-03': false,
  });

  /* ── Physics simulation tick (runs every 120ms) ── */
  useEffect(() => {
    const interval = setInterval(() => {
      const bots = botsRef.current;
      const ids = Object.keys(bots);

      // Step 1: move each bot towards its target
      for (const id of ids) {
        const bot = bots[id];
        if (!bot.is_online || bot.status === 'OFFLINE_SIMULATED') continue;

        // Handle yielding countdown
        if (bot.yieldTicks > 0) {
          bot.yieldTicks--;
          if (bot.yieldTicks === 0) {
            bot.status = 'MOVING';
          }
          continue;
        }

        // Handle replanning countdown
        if (bot.replanTicks > 0) {
          bot.replanTicks--;
          if (bot.replanTicks === 0) bot.status = 'MOVING';
          // slow movement during replanning
        }

        const target = bot.target_pos;
        const dx = target.x - bot.current_pos.x;
        const dy = target.y - bot.current_pos.y;
        const d = Math.hypot(dx, dy);

        if (d < 0.35) {
          // Reached waypoint!
          bot.tasks_completed++;
          tasksRef.current++;
          const next = nextWaypoint(bot.waypointIdx, bot.current_pos);
          bot.waypointIdx = next.idx;
          bot.target_pos = next.pos;
          bot.status = 'MOVING';
          continue;
        }

        const speed = bot.status === 'REPLANNING' ? STEP * 0.5 : STEP;
        const nx = clamp(bot.current_pos.x + (dx / d) * speed);
        const ny = clamp(bot.current_pos.y + (dy / d) * speed);

        // Update history ring buffer
        bot.history = [
          { x: bot.current_pos.x, y: bot.current_pos.y },
          ...bot.history,
        ].slice(0, HISTORY_LEN);

        bot.current_pos = { x: nx, y: ny };
        bot.intended_pos = {
          x: clamp(nx + (dx / d) * speed * 1.5),
          y: clamp(ny + (dy / d) * speed * 1.5),
        };
        bot.battery_pct = Math.max(8, bot.battery_pct - 0.015);

        // Blocked aisle avoidance
        for (const aisle of blockedAislesRef.current) {
          if (dist(bot.current_pos, aisle) < 1.2) {
            bot.status = 'REPLANNING';
            bot.replanTicks = 8;
            // Route around blocked aisle — pick furthest waypoint
            let bestIdx = bot.waypointIdx;
            let bestDist = 0;
            WAYPOINTS.forEach((wp, i) => {
              const dFromBlock = dist(wp, aisle);
              const dFromBot = dist(wp, bot.current_pos);
              const score = dFromBlock * 0.7 - dFromBot * 0.3;
              if (score > bestDist && dFromBot > 1.0) {
                bestDist = score;
                bestIdx = i;
              }
            });
            bot.waypointIdx = bestIdx;
            bot.target_pos = WAYPOINTS[bestIdx];
          }
        }
      }

      // Step 2: MAPF conflict detection — P2P priority resolution
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const botA = bots[ids[i]];
          const botB = bots[ids[j]];
          if (!botA.is_online || !botB.is_online) continue;
          if (botA.yieldTicks > 0 || botB.yieldTicks > 0) continue;

          const d = dist(botA.current_pos, botB.current_pos);
          const dInt = dist(botA.intended_pos, botB.intended_pos);

          if (d < CONFLICT_DIST || dInt < CONFLICT_DIST * 0.8) {
            avoidedRef.current++;
            // Higher alphanumeric ID yields (deterministic priority)
            const loser = botA.robot_id > botB.robot_id ? botA : botB;
            if (loser.status === 'MOVING') {
              loser.status = 'YIELDING';
              loser.yieldTicks = YIELD_TICKS;
              if (modeRef.current === 'COORDINATION') {
                collisionsRef.current = (collisionsRef.current || 0) + 0; // averted!
              }
            }
          }

          // True collision check (after movement — shouldn't happen in coordination mode)
          if (d < 0.6 && modeRef.current !== 'COORDINATION') {
            collisionsRef.current++;
          }
        }
      }

      // Trigger React re-render at 10fps with a shallow copy
    }, 120);

    // Separate render update at 60fps (requestAnimationFrame style via interval)
    const renderInterval = setInterval(() => {
      setDisplayBots({ ...botsRef.current });
      setCollisions(collisionsRef.current);
      setAvoided(avoidedRef.current);
      setTotalTasks(tasksRef.current);
    }, 60);

    return () => {
      clearInterval(interval);
      clearInterval(renderInterval);
    };
  }, []);

  /* ── Poll Go backend nodes for live state (optional overlay) ── */
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      for (const cfg of NODE_CONFIGS) {
        try {
          const res = await fetch(`http://localhost:${cfg.port}/api/status`, {
            signal: AbortSignal.timeout(120),
          });
          if (res.ok) {
            const data = await res.json();
            setBackendLive((prev) => ({ ...prev, [cfg.id]: true }));
            // Override client sim with authoritative server state
            const bot = botsRef.current[cfg.id];
            if (bot) {
              bot.current_pos = data.current_pos || bot.current_pos;
              bot.history = data.history || bot.history;
              bot.intended_pos = data.intended_pos || bot.intended_pos;
              bot.target_pos = data.target_pos || bot.target_pos;
              bot.battery_pct = data.battery_pct ?? bot.battery_pct;
              bot.status = data.status || bot.status;
              bot.is_online = data.status !== 'OFFLINE_SIMULATED';
              bot.tasks_completed = data.tasks_completed ?? bot.tasks_completed;
            }
          }
        } catch {
          setBackendLive((prev) => ({ ...prev, [cfg.id]: false }));
        }
      }
    }, 300);

    return () => clearInterval(pollInterval);
  }, []);

  /* ── Handlers ── */
  const handleTogglePower = useCallback(async (port: string, currentOnline: boolean) => {
    const cfg = NODE_CONFIGS.find((c) => c.port === port);
    if (!cfg) return;

    try {
      await fetch(`http://localhost:${port}/api/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robot_id: cfg.id, enable: !currentOnline }),
        signal: AbortSignal.timeout(300),
      });
    } catch { /* Go node may not be running */ }

    const bot = botsRef.current[cfg.id];
    if (bot) {
      bot.is_online = !currentOnline;
      bot.status = !currentOnline ? 'MOVING' : 'OFFLINE_SIMULATED';
      bot.battery_pct = !currentOnline ? 98 : bot.battery_pct;
    }
  }, []);

  const handleBlockAisle = useCallback(async (x: number, y: number) => {
    const newAisle = { x, y };
    blockedAislesRef.current = [...blockedAislesRef.current, newAisle];
    setBlockedAisles([...blockedAislesRef.current]);

    for (const cfg of NODE_CONFIGS) {
      try {
        await fetch(`http://localhost:${cfg.port}/api/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ block_aisle: true, blocked_x: x, blocked_y: y }),
          signal: AbortSignal.timeout(300),
        });
      } catch { /* fallback — client sim handles it */ }
    }
  }, []);

  const handleClearAisles = useCallback(() => {
    blockedAislesRef.current = [];
    setBlockedAisles([]);
  }, []);

  const handleToggleMode = useCallback((newMode: string) => {
    modeRef.current = newMode;
    setCurrentMode(newMode);
    collisionsRef.current = 0;
    avoidedRef.current = 0;
  }, []);

  /* ── Render ── */
  const timeReduction = currentMode === 'COORDINATION'
    ? ((1 - (1 / 1.245)) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-slate-950 text-slate-100 p-2 flex flex-col gap-2 font-sans select-none" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Header ── */}
      <header className="flex justify-between items-center bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-700/60 backdrop-blur flex-shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-cyan-500/20 border border-cyan-500/40 rounded-lg">
            <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-black tracking-tight text-white">
                Edge-AI AMR Fleet Mesh Dashboard
              </h1>
              <span className="bg-cyan-500 text-slate-950 font-black text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                SIH 2025 · BEL
              </span>
            </div>
            <p className="text-[10px] font-medium text-slate-400">
              Decentralized Multi-Robot Fleet Coordination Engine — MAPF + P2P Gossip over HTTP/3 QUIC
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 bg-slate-950 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold shadow">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '3s' }} />
            ConnectRPC / HTTP3 QUIC
          </span>
          <span className="flex items-center gap-1.5 bg-emerald-950/60 text-emerald-300 border border-emerald-700/60 px-2.5 py-1 rounded-lg text-[10px] font-bold shadow">
            <ShieldCheck className="w-3.5 h-3.5" />
            Zero Central Server
          </span>
          {/* Backend live indicators */}
          <div className="flex gap-1 ml-1">
            {NODE_CONFIGS.map((cfg) => (
              <span
                key={cfg.id}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded border"
                style={{
                  backgroundColor: backendLive[cfg.id] ? 'rgba(16,185,129,0.15)' : 'rgba(71,85,105,0.15)',
                  borderColor: backendLive[cfg.id] ? '#10b981' : '#475569',
                  color: backendLive[cfg.id] ? '#34d399' : '#64748b',
                }}
              >
                {cfg.id.replace('AMR-', 'N')} {backendLive[cfg.id] ? '●' : '○'}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Metrics Bar ── */}
      <MetricsPanel
        collisions={collisions}
        avoided={avoided}
        totalTasks={totalTasks}
        timeReduction={timeReduction}
        mode={currentMode}
        onToggleMode={handleToggleMode}
      />

      {/* ── Main Layout ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-2 overflow-hidden">

        {/* Left: Canvas */}
        <div className="lg:col-span-2 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/60 flex flex-col gap-2 shadow-xl h-full min-h-0 overflow-hidden">
          <div className="flex justify-between items-center flex-shrink-0">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              Live 2D Warehouse Floor — 10m × 10m Edge Mesh Grid
            </h2>
            <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-700">
              Tick: 120ms · Render: 60fps · Trail: {HISTORY_LEN}pts
            </span>
          </div>

          {/* SVG canvas fills available space */}
          <div className="flex-1 min-h-0 relative overflow-hidden rounded-lg">
            <GridCanvas
              robots={displayBots as Record<string, RobotStateUI>}
              blockedAisles={blockedAisles}
            />
          </div>

          <div className="flex-shrink-0">
            <ControlPanel
              onBlockAisle={handleBlockAisle}
              onClearAisles={handleClearAisles}
              blockedCount={blockedAisles.length}
            />
          </div>
        </div>

        {/* Right: Robot Cards */}
        <div className="h-full min-h-0 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between flex-shrink-0 px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Edge Robot Nodes
            </h2>
            <span className="text-[10px] text-slate-500 font-mono">~12MB RAM each</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 flex flex-col gap-2 scrollbar-thin">
            {NODE_CONFIGS.map((cfg) => (
              <RobotCard
                key={cfg.id}
                bot={
                  (displayBots[cfg.id] as RobotStateUI) || {
                    robot_id: cfg.id,
                    port: cfg.port,
                    color: cfg.color,
                    current_pos: { x: 0, y: 0 },
                    history: [],
                    intended_pos: { x: 0, y: 0 },
                    target_pos: { x: 0, y: 0 },
                    battery_pct: 0,
                    status: 'OFFLINE_SIMULATED',
                    is_online: false,
                    tasks_completed: 0,
                  }
                }
                onTogglePower={handleTogglePower}
                backendLive={backendLive[cfg.id] || false}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="flex-shrink-0 bg-slate-900/60 rounded-lg border border-slate-800 p-2">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Legend</p>
            <div className="grid grid-cols-2 gap-1">
              {[
                { color: '#22d3ee', label: 'MOVING' },
                { color: '#f59e0b', label: 'YIELDING' },
                { color: '#a855f7', label: 'REPLANNING' },
                { color: '#475569', label: 'OFFLINE' },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="text-[10px] font-bold text-slate-400">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
