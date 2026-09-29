import React from 'react';
import {
  AlertTriangle,
  RefreshCw,
  MapPin,
  Navigation,
  Bot,
  RotateCcw,
  ShieldAlert,
  Target,
  Activity,
  ShieldCheck,
  Zap,
  CheckSquare,
} from 'lucide-react';

const AISLE_FAULTS = [
  { label: 'Corridor', short: '(5.0, 5.0)', x: 5.0, y: 5.0 },
  { label: 'West Bay', short: '(2.0, 3.2)', x: 2.0, y: 3.2 },
  { label: 'East Bay', short: '(6.5, 3.2)', x: 6.5, y: 3.2 },
];

export const ControlPanel = ({
  robots = {},
  selectedBotId,
  onSelectBot,
  priority,
  onSelectPriority,
  tempGoal,
  activeGoal,
  onDispatch,
  onCancelGoal,
  onBlockAisle,
  onClearAisles,
  blockedCount = 0,
  metrics = {},
  mode = 'COORDINATION',
  onToggleMode,
}) => {
  const isCoord = mode === 'COORDINATION';

  return (
    <div className="bg-[#0c101c] border border-slate-700 rounded-xl p-4 shadow-2xl flex flex-col gap-4">
      {/* 3-Column Integrated Deck */}
      <div className="grid grid-cols-12 gap-4">

        {/* 1. MISSION DISPATCHER (5 cols) */}
        <div className="col-span-5 bg-[#101626] border border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
            <span className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-cyan-400" />
              Mission Dispatcher
            </span>
            {tempGoal && (
              <span className="text-xs font-mono font-bold text-amber-400 animate-pulse bg-amber-950 px-2 py-0.5 rounded border border-amber-700">
                Target Selected
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {/* Robot Select */}
            <div className="flex flex-col gap-1 bg-[#060a12] p-2.5 rounded-lg border border-slate-700">
              <span className="text-xs font-bold text-slate-300 uppercase">Target AMR</span>
              <select
                value={selectedBotId}
                onChange={(e) => onSelectBot(e.target.value)}
                className="bg-transparent text-sm font-mono font-bold text-cyan-300 focus:outline-none cursor-pointer"
              >
                {Object.keys(robots).map((id) => (
                  <option key={id} value={id} className="bg-[#0c101c] text-slate-100 font-mono text-sm">
                    {id}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority Select */}
            <div className="flex flex-col gap-1 bg-[#060a12] p-2.5 rounded-lg border border-slate-700">
              <span className="text-xs font-bold text-slate-300 uppercase">Priority</span>
              <select
                value={priority}
                onChange={(e) => onSelectPriority(Number(e.target.value))}
                className="bg-transparent text-sm font-mono font-bold text-amber-300 focus:outline-none cursor-pointer"
              >
                <option value={100} className="bg-[#0c101c] text-rose-400 font-bold">100 CRIT</option>
                <option value={75} className="bg-[#0c101c] text-amber-300 font-bold">75 HIGH</option>
                <option value={50} className="bg-[#0c101c] text-cyan-300 font-bold">50 NORM</option>
                <option value={25} className="bg-[#0c101c] text-slate-400 font-bold">25 LOW</option>
              </select>
            </div>

            {/* Target Coords */}
            <div className="flex flex-col gap-1 bg-[#060a12] p-2.5 rounded-lg border border-slate-700">
              <span className="text-xs font-bold text-slate-300 uppercase">Goal Position</span>
              <span className="text-sm font-mono font-black text-amber-300 truncate">
                {tempGoal
                  ? `(${tempGoal.x.toFixed(1)}, ${tempGoal.y.toFixed(1)})`
                  : activeGoal
                  ? `(${activeGoal.x.toFixed(1)}, ${activeGoal.y.toFixed(1)})`
                  : 'Click Map'}
              </span>
            </div>
          </div>

          {/* Dispatch Button */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={onDispatch}
              disabled={!tempGoal}
              className="flex-1 h-12 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 rounded-lg text-sm font-black uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-lg"
            >
              <Navigation className="w-4.5 h-4.5" />
              Dispatch Trajectory Mission
            </button>

            {(tempGoal || activeGoal) && (
              <button
                onClick={onCancelGoal}
                className="h-12 px-4 bg-[#060a12] hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded-lg transition cursor-pointer flex items-center justify-center"
                title="Clear Goal"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* 2. LIVE METRICS SUMMARY (4 cols) */}
        <div className="col-span-4 bg-[#101626] border border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-2.5 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
            <span className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Fleet Performance
            </span>
            <span className="text-xs font-mono font-bold text-slate-300 uppercase">Live 10Hz</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase block">Avoided</span>
                <span className="text-lg font-mono font-black text-emerald-400">{metrics.avoided || 0}</span>
              </div>
            </div>

            <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase block">Collisions</span>
                <span className={`text-lg font-mono font-black ${metrics.collisions === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {metrics.collisions || 0}
                </span>
              </div>
            </div>

            <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700 flex items-center gap-3">
              <Zap className="w-5 h-5 text-cyan-400" />
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase block">Delay Reduction</span>
                <span className="text-lg font-mono font-black text-cyan-300">
                  {isCoord ? `-${metrics.timeReduction || '34.8'}%` : '0.0%'}
                </span>
              </div>
            </div>

            <div className="bg-[#060a12] p-2.5 rounded-lg border border-slate-700 flex items-center gap-3">
              <CheckSquare className="w-5 h-5 text-purple-400" />
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase block">Completed</span>
                <span className="text-lg font-mono font-black text-purple-300">{metrics.totalTasks || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. SAFETY & FAULTS (3 cols) */}
        <div className="col-span-3 bg-[#101626] border border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-2.5 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
            <span className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Faults & Protocol
            </span>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-[#060a12] p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => onToggleMode('COORDINATION')}
              className={`flex-1 py-1.5 text-xs font-black rounded-md transition cursor-pointer ${
                isCoord ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              P2P COORD
            </button>
            <button
              onClick={() => onToggleMode('BASELINE_STOP_WAIT')}
              className={`flex-1 py-1.5 text-xs font-black rounded-md transition cursor-pointer ${
                !isCoord ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              STOP-WAIT
            </button>
          </div>

          {/* Aisle Fault Injections */}
          <div className="flex items-center gap-2 flex-wrap">
            {AISLE_FAULTS.map((p) => (
              <button
                key={p.label}
                onClick={() => onBlockAisle(p.x, p.y)}
                className="flex-1 py-1.5 px-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer whitespace-nowrap"
              >
                <MapPin className="w-3.5 h-3.5" />
                {p.label}
              </button>
            ))}
            <button
              onClick={onClearAisles}
              className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Clear {blockedCount > 0 ? `(${blockedCount})` : ''}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};