import React from 'react';
import { ShieldCheck, Zap, Activity, CheckSquare, AlertTriangle, Layers } from 'lucide-react';

export const MetricsPanel = ({
  collisions = 0,
  avoided = 0,
  totalTasks = 0,
  timeReduction = '0.0',
  mode = 'COORDINATION',
  onToggleMode,
}) => {
  const isCoord = mode === 'COORDINATION';

  return (
    <div className="bg-[#0c1222]/95 border border-slate-700/80 p-4 rounded-xl shadow-2xl backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
      {/* Fleet Operating Mode Switch */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5 text-cyan-400">
          <Activity className="w-5 h-5" />
          <span className="text-xs font-black uppercase tracking-wider text-slate-200">Coordination Protocol</span>
        </div>

        <div className="flex bg-slate-950 p-1.5 rounded-xl border border-slate-700">
          <button
            onClick={() => onToggleMode('COORDINATION')}
            className={`px-5 py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
              isCoord
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Zap className="w-4 h-4" />
            P2P SPACE-TIME COORD
          </button>
          <button
            onClick={() => onToggleMode('BASELINE_STOP_WAIT')}
            className={`px-5 py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
              !isCoord
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            BASELINE STOP / WAIT
          </button>
        </div>
      </div>

      {/* Real-time Fleet Metrics Cards */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Avoided Potential Collisions */}
        <div className="bg-slate-950 border border-slate-700 px-4 py-2.5 rounded-xl flex items-center gap-3.5 min-w-[150px]">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Conflicts Avoided</div>
            <div className="text-lg font-mono font-black text-emerald-400">{avoided}</div>
          </div>
        </div>

        {/* Collisions */}
        <div className="bg-slate-950 border border-slate-700 px-4 py-2.5 rounded-xl flex items-center gap-3.5 min-w-[150px]">
          <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Collisions</div>
            <div className={`text-lg font-mono font-black ${collisions === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {collisions}
            </div>
          </div>
        </div>

        {/* Time Savings */}
        <div className="bg-slate-950 border border-slate-700 px-4 py-2.5 rounded-xl flex items-center gap-3.5 min-w-[150px]">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Delay Reduction</div>
            <div className="text-lg font-mono font-black text-cyan-300">
              {isCoord ? `-${timeReduction}%` : '0.0%'}
            </div>
          </div>
        </div>

        {/* Tasks Completed */}
        <div className="bg-slate-950 border border-slate-700 px-4 py-2.5 rounded-xl flex items-center gap-3.5 min-w-[150px]">
          <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <CheckSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tasks Completed</div>
            <div className="text-lg font-mono font-black text-purple-300">{totalTasks}</div>
          </div>
        </div>
      </div>
    </div>
  );
};