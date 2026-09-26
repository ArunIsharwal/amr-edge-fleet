import React from 'react';
import { ShieldCheck, Zap, Activity, CheckSquare, AlertTriangle } from 'lucide-react';

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
    <div className="bg-slate-900/90 border border-slate-800 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md backdrop-blur">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-black uppercase tracking-wider text-slate-200">Mode</span>
        <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => onToggleMode('COORDINATION')}
            className={`px-2.5 py-1 text-[10px] font-black rounded transition-all ${
              isCoord ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚡ P2P COORD
          </button>
          <button
            onClick={() => onToggleMode('BASELINE_STOP_WAIT')}
            className={`px-2.5 py-1 text-[10px] font-black rounded transition-all ${
              !isCoord ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            🛑 STOP-WAIT
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Avoided</div>
            <div className="text-sm font-mono font-black text-emerald-400">{avoided}</div>
          </div>
        </div>

        <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Collisions</div>
            <div className={`text-sm font-mono font-black ${collisions === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {collisions}
            </div>
          </div>
        </div>

        <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-cyan-400" />
          <div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Time Saved</div>
            <div className="text-sm font-mono font-black text-cyan-300">
              {isCoord ? `-${timeReduction}%` : '0%'}
            </div>
          </div>
        </div>

        <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 flex items-center gap-2">
          <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
          <div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Completed</div>
            <div className="text-sm font-mono font-black text-purple-300">{totalTasks}</div>
          </div>
        </div>
      </div>
    </div>
  );
};