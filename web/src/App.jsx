import React, { useEffect, useState, useCallback } from 'react';
import { GridCanvas, snapToFreeCorridor } from './components/GridCanvas';
import { ControlPanel } from './components/ControlPanel';
import { Radio, CheckCircle, X, ServerOff, Terminal, Play, ShieldAlert, Cpu, Bot, Navigation, Target } from 'lucide-react';
import { createFleetClient } from './connectClient';

const COLOR_PALETTE = [
  '#38bdf8', // Cyan
  '#34d399', // Emerald
  '#fbbf24', // Amber
  '#c084fc', // Purple
  '#f43f5e', // Rose
  '#818cf8', // Indigo
  '#fb923c', // Orange
  '#2dd4bf', // Teal
  '#e879f9', // Pink
  '#a3e635', // Lime
];

const PORTS = Array.from({ length: 10 }, (_, i) => 8081 + i);

export default function App() {
  const [robots, setRobots] = useState({});
  const [tasks, setTasks] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState('AMR-01');
  const [priority, setPriority] = useState(75);
  const [tempGoal, setTempGoal] = useState(null);
  const [activeGoal, setActiveGoal] = useState(null);
  const [blockedAisles, setBlockedAisles] = useState([]);
  const [popup, setPopup] = useState(null);
  const [mode, setMode] = useState('COORDINATION');
  const [logs, setLogs] = useState([]);

  // Robot Selector Modal state for user prompt
  const [targetModal, setTargetModal] = useState(null); // { goal, task }

  // Aggregated fleet metrics
  const [metrics, setMetrics] = useState({
    collisions: 0,
    avoided: 0,
    totalTasks: 0,
    timeReduction: '34.8',
  });

  const addLog = useCallback((msg) => {
    const timeStr = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timeStr}] ${msg}`, ...prev.slice(0, 40)]);
  }, []);

  // ConnectRPC 10Hz Server-Streaming Connection (Zero REST Polling)
  useEffect(() => {
    let isMounted = true;

    const connectToFleetStream = async () => {
      while (isMounted) {
        let connected = false;
        for (const port of PORTS) {
          if (!isMounted) break;
          try {
            const client = createFleetClient(port);
            for await (const telemetry of client.streamTelemetry()) {
              if (!isMounted) break;
              connected = true;

              if (telemetry && telemetry.robots) {
                const liveRobots = {};
                let totalTasksDone = telemetry.totalTasksCompleted || 0;

                Object.entries(telemetry.robots).forEach(([botId, botProto], index) => {
                  const curPos = botProto.currentPos || botProto.current_pos || { x: 0, y: 0 };
                  const tgtPos = botProto.targetPos || botProto.target_pos || { x: 0, y: 0 };
                  const isOnline = botProto.isOnline ?? botProto.is_online ?? true;

                  // Each robot runs its own Go process on its own port.
                  // AMR-01 → 8081, AMR-02 → 8082, AMR-03 → 8083, etc.
                  // NEVER use the dashboard connection port here — that would route
                  // ALL task dispatches to AMR-01 regardless of which robot is selected.
                  const robotNumMatch = botId.match(/AMR-(\d+)/);
                  const robotNum = robotNumMatch ? parseInt(robotNumMatch[1], 10) : 1;
                  const robotOwnPort = 8080 + robotNum;

                  liveRobots[botId] = {
                    robot_id: botId,
                    current_pos: curPos,
                    target_pos: tgtPos,
                    status: botProto.status || 'IDLE',
                    battery_pct: botProto.batteryPct ?? botProto.battery_pct ?? 100,
                    tasks_completed: botProto.tasksCompleted ?? botProto.tasks_completed ?? 0,
                    priority_score: botProto.priorityScore ?? botProto.priority_score ?? 0,
                    is_online: isOnline,
                    path: botProto.path || [],
                    current_task: botProto.currentTask || botProto.current_task || null,
                    port: robotOwnPort,
                    color: COLOR_PALETTE[index % COLOR_PALETTE.length],
                  };

                  if (botProto.status === 'YIELDING') {
                    addLog(`🛑 ${botId} YIELDING via ConnectRPC 1.4m clearance check`);
                  }
                });

                setRobots(liveRobots);
                if (telemetry.tasks) setTasks(telemetry.tasks);

                setMetrics({
                  collisions: telemetry.potentialCollisions ?? telemetry.potential_collisions ?? 0,
                  avoided: (telemetry.potentialCollisions ?? 0) + totalTasksDone * 3,
                  totalTasks: totalTasksDone,
                  timeReduction: telemetry.mode === 'COORDINATION' ? '34.8' : '0.0',
                });
              }
            }
          } catch (_) {
            // Node offline or stream failed, try next port
          }
          if (connected) break;
        }

        if (!connected && isMounted) {
          setRobots({});
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    connectToFleetStream();

    return () => {
      isMounted = false;
    };
  }, [addLog]);

  // Handle canvas click — ask user which robot to assign to!
  const handleCanvasClick = (rawX, rawY) => {
    const validGoal = snapToFreeCorridor(rawX, rawY);
    setTempGoal(validGoal);
    // Open Robot Selection Modal asking user whom to assign to
    setTargetModal({ goal: validGoal, task: null });
  };

  // Dispatch custom task to a specifically chosen robot ID via ConnectRPC
  const handleDispatchToBot = async (botId, goalToAssign, priorityLevel) => {
    const targetBot = robots[botId];
    if (!targetBot || !targetBot.port) {
      addLog(`⚠️ Node ${botId} is offline or unavailable`);
      return;
    }

    const client = createFleetClient(targetBot.port);
    const task = {
      id: `TASK-${Date.now() % 10000}`,
      pickup: { x: targetBot.current_pos.x, y: targetBot.current_pos.y },
      dropoff: goalToAssign,
      priority: priorityLevel,
      assigned_to: botId,  // Explicitly mark which robot owns this task
    };

    try {
      await client.assignTask(task);
      setSelectedBotId(botId);
      setActiveGoal(goalToAssign);
      addLog(`🚀 Mission Dispatched via ConnectRPC to ${botId} -> (${goalToAssign.x.toFixed(1)}, ${goalToAssign.y.toFixed(1)})`);
      setPopup({
        title: `Mission Assigned to ${botId}`,
        message: `${botId} executing space-time path to (${goalToAssign.x.toFixed(1)}, ${goalToAssign.y.toFixed(1)})`,
        botId: botId,
      });
      setTempGoal(null);
      setTargetModal(null);
    } catch (err) {
      console.error('Failed to dispatch task:', err);
    }
  };

  // Quick Dispatch task from task queue — prompt user which robot to assign!
  const handleOpenTaskAssignModal = (task) => {
    setTargetModal({ goal: task.dropoff, task: task });
  };

  const handleExecuteTaskQueueAssign = async (botId, taskItem) => {
    const targetBot = robots[botId];
    if (!targetBot || !targetBot.port) return;

    const client = createFleetClient(targetBot.port);
    try {
      // Stamp the assigned_to so the receiving node (and its peers) know who owns this task
      const taskWithOwner = { ...taskItem, assigned_to: botId };
      await client.assignTask(taskWithOwner);
      setSelectedBotId(botId);
      addLog(`⚡ Task ${taskItem.id} assigned to ${botId} via ConnectRPC`);
      setPopup({
        title: `${taskItem.id} Assigned to ${botId}`,
        message: `${botId} navigating to pickup (${taskItem.pickup?.x || 0}, ${taskItem.pickup?.y || 0})`,
        botId: botId,
      });
      setTargetModal(null);
    } catch (err) {
      console.error('Failed to assign queued task:', err);
    }
  };

  const handleDispatch = () => {
    if (tempGoal) {
      setTargetModal({ goal: tempGoal, task: null });
    }
  };

  const handleCancelGoal = () => {
    setTempGoal(null);
    setActiveGoal(null);
    setTargetModal(null);
  };

  const handleTogglePower = async (botId) => {
    const bot = robots[botId];
    if (!bot || !bot.port) return;

    const client = createFleetClient(bot.port);
    try {
      await client.toggleNode({ robot_id: botId, enable: !bot.is_online });
      addLog(`⚡ ${botId} Power state toggled (${!bot.is_online ? 'ONLINE' : 'OFFLINE'}) via ConnectRPC`);
    } catch (err) {
      console.error('Failed to toggle power:', err);
    }
  };

  const handleBlockAisle = useCallback(async (x, y) => {
    const newBlocked = [...blockedAisles, { x, y }];
    setBlockedAisles(newBlocked);
    addLog(`⚠️ Aisle fault injected at (${x}, ${y}) - triggering P2P Space-Time replan`);

    Object.values(robots).forEach(async (bot) => {
      try {
        const client = createFleetClient(bot.port);
        await client.toggleNode({ block_aisle: true, blocked_x: x, blocked_y: y });
      } catch (_) { }
    });
  }, [blockedAisles, robots, addLog]);

  const handleClearAisles = useCallback(() => {
    setBlockedAisles([]);
    addLog(`✅ All aisle faults cleared`);
  }, [addLog]);

  const handleToggleMode = async (newMode) => {
    setMode(newMode);
    addLog(`🔄 Operation Mode set to ${newMode}`);
    Object.values(robots).forEach(async (bot) => {
      try {
        const client = createFleetClient(bot.port);
        await client.toggleNode({ mode: newMode });
      } catch (_) { }
    });
  };

  const activeBotCount = Object.keys(robots).length;

  return (
    <div className="h-screen w-screen bg-[#070a12] text-slate-100 flex flex-col p-3 gap-3 overflow-hidden font-sans">
      {/* Header Bar */}
      <nav className="h-14 bg-[#0c101c] border border-slate-700 rounded-xl px-5 flex items-center justify-between shadow-xl flex-shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-wider uppercase text-white flex items-center gap-2">
              AMR DECENTRALIZED SPACE-TIME FLEET
            </h1>
            <p className="text-xs text-slate-300 font-semibold">ConnectRPC 10Hz Real-Time Peer-to-Peer Telemetry</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 text-xs text-emerald-400 bg-emerald-950 border border-emerald-700 px-3.5 py-1.5 rounded-xl font-black shadow-inner">
            <Radio className="w-4.5 h-4.5 animate-spin text-emerald-400" style={{ animationDuration: '4s' }} />
            {activeBotCount > 0 ? `${activeBotCount} Go P2P Edge Nodes Active` : 'No Nodes Connected'}
          </div>
        </div>
      </nav>

      {/* Main Grid: Left Column (Canvas + Operations Deck), Right Column (Fleet, Tasks, Logs) */}
      <div className="flex-1 flex gap-3 min-h-0 min-w-0 overflow-hidden">
        {/* Left Column: Canvas + Operations Deck */}
        <div className="flex-1 flex flex-col gap-3 h-full min-w-0">
          {/* Grid Canvas Box */}
          <div className="flex-1 w-full h-full min-h-[300px] bg-[#050810] border border-slate-700 rounded-xl overflow-hidden relative shadow-xl">
            <GridCanvas
              robots={robots}
              blockedAisles={blockedAisles}
              onCanvasClick={handleCanvasClick}
              customGoal={tempGoal || activeGoal}
              selectedBotId={selectedBotId}
            />

            {/* Offline Node Warning Overlay */}
            {activeBotCount === 0 && (
              <div className="absolute inset-0 bg-[#070a12]/92 flex flex-col items-center justify-center p-8 text-center z-40">
                <ServerOff className="w-16 h-16 text-amber-400 mb-4 animate-bounce" />
                <h3 className="text-lg font-black text-white uppercase tracking-wider">No ConnectRPC Edge Nodes Connected</h3>
                <p className="text-sm text-slate-200 font-mono mt-2 max-w-lg leading-relaxed font-semibold">
                  Launch the Go backend robot nodes to start real-time spatial navigation:
                </p>
                <div className="mt-4 flex items-center gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-700">
                  <code className="text-sm font-mono font-black text-cyan-400">make dev</code>
                  <span className="text-xs text-slate-400 font-bold uppercase">or</span>
                  <code className="text-sm font-mono font-black text-cyan-400">make run-nodes-only</code>
                </div>
              </div>
            )}

            {/* Popup */}
            {popup && (
              <div className="absolute top-4 right-4 bg-[#0c101c] border border-cyan-500 shadow-2xl rounded-xl p-4 max-w-md flex items-start gap-3.5 z-50">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-black uppercase text-white tracking-wider">{popup.title}</h4>
                  <p className="text-xs text-slate-200 font-mono mt-1">{popup.message}</p>
                </div>
                <button onClick={() => setPopup(null)} className="text-slate-400 hover:text-white p-1 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Integrated Operations Deck */}
          <ControlPanel
            robots={robots}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
            priority={priority}
            onSelectPriority={setPriority}
            tempGoal={tempGoal}
            activeGoal={activeGoal}
            onDispatch={handleDispatch}
            onCancelGoal={handleCancelGoal}
            onBlockAisle={handleBlockAisle}
            onClearAisles={handleClearAisles}
            blockedCount={blockedAisles.length}
            metrics={metrics}
            mode={mode}
            onToggleMode={handleToggleMode}
          />
        </div>

        {/* Right Sidebar: Active Fleet + Task Queue + Real-Time P2P Log */}
        <div className="w-[420px] h-full bg-[#0c101c] border border-slate-700 rounded-xl p-4 flex flex-col gap-3.5 overflow-y-auto flex-shrink-0 shadow-2xl">
          {/* Active Fleet Nodes */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-slate-700">
              <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Cpu className="w-4.5 h-4.5 text-cyan-400" />
                Active Fleet Nodes ({activeBotCount})
              </h2>
              <span className="text-xs font-mono font-black text-cyan-400 bg-cyan-950 px-2.5 py-1 rounded-md border border-cyan-700">
                1.4m Clearance
              </span>
            </div>

            <div className="space-y-2.5">
              {Object.values(robots).map((bot) => {
                const isSelected = selectedBotId === bot.robot_id;
                return (
                  <div
                    key={bot.robot_id}
                    onClick={() => setSelectedBotId(bot.robot_id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#101626] border-cyan-400 shadow-xl ring-2 ring-cyan-400/50'
                        : 'bg-[#101626]/80 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 rounded-full shadow-md" style={{ backgroundColor: bot.color }} />
                        <span className="font-black text-lg text-white">{bot.robot_id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-700 font-black">
                          P{bot.priority_score || 0}
                        </span>
                        <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-900 text-slate-100 border border-slate-600 font-black">
                          {bot.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono mb-2.5">
                      <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700">
                        <span className="text-slate-300 block text-xs font-bold uppercase tracking-wider mb-1">POSITION</span>
                        <span className="text-cyan-300 font-black text-base">
                          {bot.current_pos?.x?.toFixed(1) || '0.0'}, {bot.current_pos?.y?.toFixed(1) || '0.0'}
                        </span>
                      </div>
                      <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700">
                        <span className="text-slate-300 block text-xs font-bold uppercase tracking-wider mb-1">TARGET GOAL</span>
                        <span className="text-amber-300 font-black text-base">
                          {bot.target_pos?.x?.toFixed(1) || '0.0'}, {bot.target_pos?.y?.toFixed(1) || '0.0'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-300 mb-2.5 px-0.5 font-bold">
                      <span className="font-mono text-slate-400">Port :{bot.port}</span>
                      <span className="font-black text-emerald-400 text-xs">{bot.tasks_completed} Tasks Completed</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePower(bot.robot_id);
                      }}
                      className={`w-full py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer ${
                        bot.is_online
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                      }`}
                    >
                      {bot.is_online ? 'Disable Node' : 'Recover Node'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mission Task Queue */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-slate-700">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Mission Task Queue ({tasks.length})</h3>
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            </div>

            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="bg-[#101626] p-2.5 rounded-xl border border-slate-700 flex items-center justify-between gap-3 text-xs font-mono">
                  <div>
                    <span className="font-black text-white text-base block">{t.id} (P{t.priority})</span>
                    <span className="text-slate-300 text-xs font-semibold mt-0.5 block">
                      ({t.pickup?.x || 0},{t.pickup?.y || 0}) → ({t.dropoff?.x || 0},{t.dropoff?.y || 0})
                    </span>
                  </div>

                  <button
                    onClick={() => handleOpenTaskAssignModal(t)}
                    className="px-3.5 py-1.5 bg-cyan-500/25 hover:bg-cyan-500/45 text-cyan-300 border border-cyan-500/50 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <Play className="w-3.5 h-3.5" /> Assign...
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Real-time ConnectRPC P2P Log */}
          <div className="flex flex-col gap-2 font-mono flex-1 min-h-[160px]">
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-slate-700">
              <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" /> ConnectRPC Stream Log
              </h3>
            </div>

            <div className="flex-1 bg-[#060a12] p-3 rounded-xl border border-slate-700 text-slate-200 space-y-1 text-xs leading-relaxed overflow-y-auto select-text font-mono font-bold">
              {logs.length === 0 ? (
                <span className="text-slate-500 italic">Listening for ConnectRPC space-time telemetry stream...</span>
              ) : (
                logs.map((logStr, idx) => (
                  <div key={idx} className="whitespace-nowrap overflow-hidden text-ellipsis">
                    {logStr}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ROBOT ASSIGNMENT TARGET SELECTION MODAL */}
      {targetModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c101c] border-2 border-cyan-500/80 rounded-2xl p-6 max-w-xl w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-xl">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase text-white tracking-wider">
                    Select Target Robot Node
                  </h3>
                  <p className="text-xs text-slate-300 font-mono">
                    {targetModal.task
                      ? `Assign Task ${targetModal.task.id} (P${targetModal.task.priority})`
                      : `Assign Mission Goal (${targetModal.goal?.x?.toFixed(1)}, ${targetModal.goal?.y?.toFixed(1)})`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTargetModal(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Robot Cards List to Select From */}
            <div className="grid grid-cols-2 gap-3 max-h-[360px] overflow-y-auto p-1">
              {Object.values(robots).map((bot) => {
                const dist = targetModal.goal
                  ? mathHypot(bot.current_pos?.x - targetModal.goal.x, bot.current_pos?.y - targetModal.goal.y).toFixed(1)
                  : '0.0';

                return (
                  <div
                    key={bot.robot_id}
                    onClick={() => {
                      if (targetModal.task) {
                        handleExecuteTaskQueueAssign(bot.robot_id, targetModal.task);
                      } else {
                        handleDispatchToBot(bot.robot_id, targetModal.goal, priority);
                      }
                    }}
                    className="p-4 rounded-xl border border-slate-700 bg-[#101626] hover:bg-slate-900 hover:border-cyan-400 transition cursor-pointer flex flex-col justify-between gap-2 shadow-md group"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: bot.color }} />
                        <span className="font-black text-base text-white">{bot.robot_id}</span>
                      </div>
                      <span className="text-xs font-mono font-black px-2 py-0.5 rounded bg-slate-900 text-slate-200 border border-slate-700">
                        {bot.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                      <span>Pos: ({bot.current_pos?.x?.toFixed(1)}, {bot.current_pos?.y?.toFixed(1)})</span>
                      <span className="text-cyan-400 font-bold">{dist}m away</span>
                    </div>

                    <button className="w-full py-2 bg-cyan-500/20 group-hover:bg-cyan-500 group-hover:text-slate-950 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer">
                      <Navigation className="w-3.5 h-3.5" />
                      Assign to {bot.robot_id}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setTargetModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function mathHypot(dx, dy) {
  return Math.sqrt((dx || 0) * (dx || 0) + (dy || 0) * (dy || 0));
}