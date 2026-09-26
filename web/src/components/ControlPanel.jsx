import React from 'react';
import { AlertTriangle, RefreshCw, MapPin, Navigation, Bot, RotateCcw } from 'lucide-react';

const AISLE_FAULTS = [
  { label: 'Corridor (5,5)', x: 5.0, y: 5.0 },
  { label: 'West Bay (2,3.2)', x: 2.0, y: 3.2 },
  { label: 'East Bay (6.5,3.2)', x: 6.5, y: 3.2 },
];

export const ControlPanel = ({
  robots = {},
  selectedBotId,
  onSelectBot,
  tempGoal,
  activeGoal,
  onDispatch,
  onCancelGoal,
  onBlockAisle,
  onClearAisles,
  blockedCount = 0,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md">
      {/* Robot Assignment & Dispatch Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
          <Bot className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] text-slate-400 font-bold uppercase">Assign Robot:</span>
          <select
            value={selectedBotId}
            onChange={(e) => onSelectBot(e.target.value)}
            className="bg-transparent text-xs font-mono font-bold text-cyan-300 focus:outline-none cursor-pointer"
          >
            {Object.keys(robots).map((id) => (
              <option key={id} value={id} className="bg-slate-900 text-white font-mono">
                {id} ({robots[id]?.status})
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Coordinate Badge */}
        <div className="bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs font-mono">
          <span className="text-slate-500 text-[10px] uppercase block">Selected Goal:</span>
          {tempGoal ? (
            <span className="text-amber-400 font-bold">
              ({tempGoal.x.toFixed(1)}, {tempGoal.y.toFixed(1)})
            </span>
          ) : activeGoal ? (
            <span className="text-cyan-400 font-bold">
              En Route: ({activeGoal.x.toFixed(1)}, {activeGoal.y.toFixed(1)})
            </span>
          ) : (
            <span className="text-slate-500 italic">Click Grid to Set</span>
          )}
        </div>

        {/* Dispatch Action Button */}
        <button
          onClick={onDispatch}
          disabled={!tempGoal}
          className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 rounded text-xs font-black uppercase transition-all flex items-center gap-1.5 shadow-sm"
        >
          <Navigation className="w-3 h-3" />
          Dispatch Mission
        </button>

        {(tempGoal || activeGoal) && (
          <button
            onClick={onCancelGoal}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition"
            title="Clear Goal"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Fault Injection Panel */}
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mr-1" />
        {AISLE_FAULTS.map((p) => (
          <button
            key={p.label}
            onClick={() => onBlockAisle(p.x, p.y)}
            className="px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-600/30 rounded text-[10px] font-bold flex items-center gap-1 transition"
          >
            <MapPin className="w-2.5 h-2.5" /> {p.label}
          </button>
        ))}

        <button
          onClick={onClearAisles}
          className="px-2.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-bold border border-slate-700 flex items-center gap-1 transition ml-1"
        >
          <RefreshCw className="w-2.5 h-2.5" /> Clear {blockedCount > 0 ? `(${blockedCount})` : ''}
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;