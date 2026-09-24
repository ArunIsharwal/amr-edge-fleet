import React from 'react';
import { ShieldCheck, Zap, Activity, CheckSquare, AlertTriangle } from 'lucide-react';

export interface MetricsPanelProps {
  collisions: number;
  avoided: number;
  totalTasks: number;
  timeReduction: string;
  mode: string;
  onToggleMode: (newMode: string) => void;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({
  collisions,
  avoided,
  totalTasks,
  timeReduction,
  mode,
  onToggleMode,
}) => {
  const isCoordination = mode === 'COORDINATION';

  return (
    <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-700/60 flex items-center justify-between gap-3 flex-shrink-0 shadow-md">
      {/* Title + Mode Toggle */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-200">BEL Benchmarks</span>
        <div className="flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-700 ml-1">
          <button
            onClick={() => onToggleMode('COORDINATION')}
            className={`px-2.5 py-1 text-[10px] font-black rounded transition-all uppercase tracking-wider ${
              isCoordination
                ? 'bg-cyan-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚡ P2P COORD
          </button>
          <button
            onClick={() => onToggleMode('BASELINE_STOP_WAIT')}
            className={`px-2.5 py-1 text-[10px] font-black rounded transition-all uppercase tracking-wider ${
              !isCoordination
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🛑 STOP-WAIT
          </button>
        </div>
      </div>

      {/* Metric cards inline */}
      <div className="flex gap-2 flex-1 justify-end">
        {/* Collisions Averted */}
        <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Conflicts Averted</div>
            <div className="text-base font-black font-mono text-emerald-400 leading-none">{avoided}</div>
          </div>
          <span className="text-[9px] font-black text-emerald-300 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-700/60 ml-1">
            TARGET: 0 COLLISIONS
          </span>
        </div>

        {/* Hard Collisions */}
        <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Hard Collisions</div>
            <div className={`text-base font-black font-mono leading-none ${collisions === 0 ? 'text-emerald-400' : 'text-red-400'}`}>{collisions}</div>
          </div>
        </div>

        {/* Time Reduction */}
        <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 min-w-0">
          <Zap className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Time Reduction</div>
            <div className="text-base font-black font-mono text-cyan-300 leading-none">
              {isCoordination ? `-${timeReduction}%` : '0%'}
            </div>
          </div>
          <span className="text-[9px] font-black text-cyan-300 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-700/60 ml-1">
            TARGET: ≥20%
          </span>
        </div>

        {/* Tasks Done */}
        <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 min-w-0">
          <CheckSquare className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Tasks Completed</div>
            <div className="text-base font-black font-mono text-purple-300 leading-none">{totalTasks}</div>
          </div>
        </div>

        {/* RAM */}
        <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2 min-w-0">
          <div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Edge RAM</div>
            <div className="text-base font-black font-mono text-slate-300 leading-none">~12 MB</div>
          </div>
          <span className="text-[9px] font-black text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-600 ml-1">
            RPi/Jetson
          </span>
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
