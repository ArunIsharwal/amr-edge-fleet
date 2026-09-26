import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GridCanvas, snapToFreeCorridor, GRID_WIDTH, GRID_HEIGHT } from './components/GridCanvas';
import { ControlPanel } from './components/ControlPanel';
import { Power, Battery, CheckCircle, Radio, X } from 'lucide-react';
import { findOptimizedPath } from './pathfinder';

const NODE_CONFIGS = [
  { id: 'AMR-01', color: '#38bdf8' },
  { id: 'AMR-02', color: '#34d399' },
  { id: 'AMR-03', color: '#fbbf24' },
  { id: 'AMR-04', color: '#c084fc' },
];

// Waypoints spaced across the entire 18m x 10m warehouse
const WAYPOINTS = [
  { x: 1.0, y: 1.0 },
  { x: 5.5, y: 1.0 },
  { x: 11.0, y: 1.0 },
  { x: 16.5, y: 1.0 },
  { x: 16.5, y: 4.8 },
  { x: 16.5, y: 9.0 },
  { x: 11.0, y: 9.0 },
  { x: 5.5, y: 9.0 },
  { x: 1.0, y: 9.0 },
  { x: 1.0, y: 4.8 },
];

const STEP = 0.28;
const CONFLICT_DIST = 1.3;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nextWaypoint(idx, cur) {
  for (let i = 1; i <= WAYPOINTS.length; i++) {
    const nextIdx = (idx + i) % WAYPOINTS.length;
    if (dist(cur, WAYPOINTS[nextIdx]) > 1.5) {
      return { idx: nextIdx, pos: WAYPOINTS[nextIdx] };
    }
  }
  return { idx, pos: WAYPOINTS[idx] };
}

function makeInitialBots() {
  return {
    'AMR-01': {
      robot_id: 'AMR-01',
      color: '#38bdf8',
      current_pos: { x: 1.0, y: 1.0 },
      target_pos: WAYPOINTS[3],
      path: [],
      battery_pct: 98,
      status: 'MOVING',
      is_online: true,
      tasks_completed: 0,
      waypointIdx: 3,
      yieldTicks: 0,
      customMode: false,
    },
    'AMR-02': {
      robot_id: 'AMR-02',
      color: '#34d399',
      current_pos: { x: 16.5, y: 9.0 },
      target_pos: WAYPOINTS[8],
      path: [],
      battery_pct: 95,
      status: 'MOVING',
      is_online: true,
      tasks_completed: 0,
      waypointIdx: 8,
      yieldTicks: 0,
      customMode: false,
    },
    'AMR-03': {
      robot_id: 'AMR-03',
      color: '#fbbf24',
      current_pos: { x: 5.5, y: 9.0 },
      target_pos: WAYPOINTS[1],
      path: [],
      battery_pct: 92,
      status: 'MOVING',
      is_online: true,
      tasks_completed: 0,
      waypointIdx: 1,
      yieldTicks: 0,
      customMode: false,
    },
    'AMR-04': {
      robot_id: 'AMR-04',
      color: '#c084fc',
      current_pos: { x: 11.0, y: 1.0 },
      target_pos: WAYPOINTS[6],
      path: [],
      battery_pct: 96,
      status: 'MOVING',
      is_online: true,
      tasks_completed: 0,
      waypointIdx: 6,
      yieldTicks: 0,
      customMode: false,
    },
  };
}

export default function App() {
  const botsRef = useRef(makeInitialBots());
  const blockedAislesRef = useRef([]);

  const [displayBots, setDisplayBots] = useState(botsRef.current);
  const [blockedAisles, setBlockedAisles] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('AMR-01');
  const [customGoal, setCustomGoal] = useState(null);
  const [popup, setPopup] = useState(null);

  const handleCanvasClick = (rawX, rawY) => {
    const bots = botsRef.current;
    const available = Object.keys(bots).filter((id) => bots[id].is_online);

    if (available.length === 0) return;

    // Snaps out of shelves if clicked directly on one
    const validGoal = snapToFreeCorridor(rawX, rawY);

    // Pick closest online robot across the wide floor
    let nearestBotId = available[0];
    let minDistance = dist(bots[nearestBotId].current_pos, validGoal);

    for (const id of available) {
      const d = dist(bots[id].current_pos, validGoal);
      if (d < minDistance) {
        minDistance = d;
        nearestBotId = id;
      }
    }

    const targetBot = bots[nearestBotId];
    const path = findOptimizedPath(targetBot.current_pos, validGoal, blockedAislesRef.current);

    targetBot.target_pos = validGoal;
    targetBot.path = path;
    targetBot.status = 'MOVING';
    targetBot.customMode = true;

    setSelectedBotId(nearestBotId);
    setCustomGoal(validGoal);

    setPopup({
      title: 'Dispatched Across Grid',
      message: `${nearestBotId} navigating to (${validGoal.x.toFixed(1)}, ${validGoal.y.toFixed(1)})`,
      botId: nearestBotId,
    });

    setDisplayBots({ ...botsRef.current });
  };

  const handleCancelGoal = () => {
    setCustomGoal(null);
    const bot = botsRef.current[selectedBotId];
    if (bot && bot.customMode) {
      bot.customMode = false;
      bot.path = [];
      const next = nextWaypoint(bot.waypointIdx, bot.current_pos);
      bot.target_pos = next.pos;
      bot.status = 'MOVING';
      setDisplayBots({ ...botsRef.current });
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const bots = botsRef.current;
      const ids = Object.keys(bots);

      for (const id of ids) {
        const bot = bots[id];
        if (!bot.is_online || bot.status === 'OFFLINE_SIMULATED') continue;

        if (bot.yieldTicks > 0) {
          bot.yieldTicks--;
          if (bot.yieldTicks === 0) bot.status = 'MOVING';
          continue;
        }

        if (!bot.path || bot.path.length === 0) {
          const next = nextWaypoint(bot.waypointIdx, bot.current_pos);
          bot.waypointIdx = next.idx;
          bot.target_pos = next.pos;
          bot.path = findOptimizedPath(bot.current_pos, next.pos, blockedAislesRef.current);
          bot.status = 'MOVING';
        }

        const subGoal = bot.path[0];
        const dx = subGoal.x - bot.current_pos.x;
        const dy = subGoal.y - bot.current_pos.y;
        const subDist = Math.hypot(dx, dy);

        if (subDist < 0.35) {
          bot.path.shift();

          if (bot.path.length === 0) {
            bot.tasks_completed++;
            if (bot.customMode) {
              bot.customMode = false;
              setCustomGoal(null); // Disappears immediately on goal arrival
              setPopup({
                title: 'Goal Reached',
                message: `${bot.robot_id} arrived at destination.`,
                botId: bot.robot_id,
              });
            }
          }
          continue;
        }

        const moveStep = Math.min(STEP, subDist);
        bot.current_pos = {
          x: bot.current_pos.x + (dx / subDist) * moveStep,
          y: bot.current_pos.y + (dy / subDist) * moveStep,
        };
        bot.battery_pct = Math.max(5, bot.battery_pct - 0.003);
      }

      // Mutual collision avoidance
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const bA = bots[ids[i]];
          const bB = bots[ids[j]];
          if (!bA.is_online || !bB.is_online) continue;

          if (dist(bA.current_pos, bB.current_pos) < CONFLICT_DIST) {
            const yielding = bA.robot_id > bB.robot_id ? bA : bB;
            if (yielding.status === 'MOVING') {
              yielding.status = 'YIELDING';
              yielding.yieldTicks = 4;
            }
          }
        }
      }
    }, 90);

    const renderLoop = setInterval(() => {
      setDisplayBots({ ...botsRef.current });
    }, 60);

    return () => {
      clearInterval(interval);
      clearInterval(renderLoop);
    };
  }, []);

  const handleTogglePower = (id) => {
    const bot = botsRef.current[id];
    if (bot) {
      bot.is_online = !bot.is_online;
      bot.status = bot.is_online ? 'MOVING' : 'OFFLINE_SIMULATED';
    }
  };

  const handleBlockAisle = useCallback((x, y) => {
    blockedAislesRef.current = [...blockedAislesRef.current, { x, y }];
    setBlockedAisles([...blockedAislesRef.current]);

    const bots = botsRef.current;
    Object.values(bots).forEach((bot) => {
      if (bot.is_online && bot.target_pos) {
        bot.path = findOptimizedPath(bot.current_pos, bot.target_pos, blockedAislesRef.current);
      }
    });
  }, []);

  const handleClearAisles = useCallback(() => {
    blockedAislesRef.current = [];
    setBlockedAisles([]);
  }, []);

  return (
    // Outer Container: Zero margin, full viewport width
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col p-1.5 gap-1.5 overflow-hidden font-sans">
      <nav className="h-9 bg-slate-900 border border-slate-800 rounded-lg px-3 flex items-center justify-between shadow-md flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <h1 className="text-xs font-black tracking-widest uppercase text-white">
            AMR FULL-WIDTH WAREHOUSE FLEET
          </h1>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full font-bold">
          <Radio className="w-3 h-3 animate-spin" style={{ animationDuration: '4s' }} />
          Full-Span Mesh Active
        </div>
      </nav>

      {/* Main Container - maximizes width, minimal sidebar */}
      <div className="flex-1 flex gap-1.5 min-h-0 min-w-0 overflow-hidden">
        {/* Left Side: Maximized Canvas with NO empty sidebars/margins */}
        <div className="flex-1 flex flex-col gap-1.5 h-full min-w-0">
          <div className="flex-1 w-full h-full min-h-0 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden relative shadow-inner">
            <GridCanvas
              robots={displayBots}
              blockedAisles={blockedAisles}
              onCanvasClick={handleCanvasClick}
              customGoal={customGoal}
              selectedBotId={selectedBotId}
            />

            {popup && (
              <div className="absolute top-3 right-3 bg-slate-900/95 border border-cyan-500/80 shadow-2xl rounded-lg p-2.5 max-w-xs flex items-start gap-2 backdrop-blur z-50">
                <div className="p-1 bg-cyan-500/20 text-cyan-400 rounded">
                  <CheckCircle className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[11px] font-black uppercase text-white tracking-wide">{popup.title}</h4>
                  <p className="text-[10px] text-slate-300 font-mono mt-0.5">{popup.message}</p>
                </div>
                <button onClick={() => setPopup(null)} className="text-slate-400 hover:text-white p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <ControlPanel
            robots={displayBots}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
            activeGoal={customGoal}
            onCancelGoal={handleCancelGoal}
            onBlockAisle={handleBlockAisle}
            onClearAisles={handleClearAisles}
            blockedCount={blockedAisles.length}
          />
        </div>

        {/* Compact Right Sidebar */}
        <div className="w-56 h-full flex flex-col gap-1.5 flex-shrink-0">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">Active Fleet (4)</div>
          <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto pr-0.5">
            {NODE_CONFIGS.map((cfg) => {
              const bot = displayBots[cfg.id];
              if (!bot) return null;
              const isSelected = selectedBotId === cfg.id;

              return (
                <div
                  key={cfg.id}
                  onClick={() => setSelectedBotId(cfg.id)}
                  className={`p-2 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 border-cyan-500 shadow-md ring-1 ring-cyan-500/50'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                      <span className="font-bold text-xs text-white">{bot.robot_id}</span>
                    </div>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 font-bold">
                      {bot.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-[10px] font-mono mb-1.5">
                    <div className="bg-slate-950 p-1 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[8px] font-bold">POS</span>
                      <span className="text-cyan-300">
                        {bot.current_pos.x.toFixed(1)}, {bot.current_pos.y.toFixed(1)}
                      </span>
                    </div>
                    <div className="bg-slate-950 p-1 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[8px] font-bold">GOAL</span>
                      <span className="text-amber-300">
                        {bot.target_pos.x.toFixed(1)}, {bot.target_pos.y.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                    <div className="flex items-center gap-1">
                      <Battery className="w-3 h-3" />
                      <span>{bot.battery_pct.toFixed(0)}%</span>
                    </div>
                    <span>{bot.tasks_completed} done</span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePower(cfg.id);
                    }}
                    className={`w-full py-0.5 rounded text-[9px] font-bold uppercase transition-all flex items-center justify-center gap-1 ${
                      bot.is_online
                        ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                  >
                    <Power className="w-2.5 h-2.5" />
                    {bot.is_online ? 'Stop Node' : 'Start Node'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}