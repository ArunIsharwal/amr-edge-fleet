import React from 'react';
import { AlertTriangle, RefreshCw, MapPin } from 'lucide-react';

export interface ControlPanelProps {
  onBlockAisle: (x: number, y: number) => void;
  onClearAisles: () => void;
  blockedCount: number;
}

const AISLE_POSITIONS = [
  { label: 'Center (5,5)', x: 5.0, y: 5.0 },
  { label: 'North (5,2)', x: 5.0, y: 2.0 },
  { label: 'East (8,5)', x: 8.0, y: 5.0 },
  { label: 'West (2,5)', x: 2.0, y: 5.0 },
];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  onBlockAisle,
  onClearAisles,
  blockedCount,
}) => {
  return (
    <div className="bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-700/60 flex items-center gap-2 shadow-md">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-300">Fault Injection</h3>
      </div>

      <div className="flex gap-1.5 flex-1">
        {AISLE_POSITIONS.map((pos) => (
          <button
            key={pos.label}
            onClick={() => onBlockAisle(pos.x, pos.y)}
            className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 border border-amber-600/50 rounded-lg text-[10px] font-bold transition-all"
          >
            <MapPin className="w-3 h-3" />
            {pos.label}
          </button>
        ))}
      </div>

      <button
        onClick={onClearAisles}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-black transition-all border border-slate-600 shadow flex-shrink-0"
      >
        <RefreshCw className="w-3 h-3" />
        Clear {blockedCount > 0 ? `(${blockedCount})` : ''}
      </button>
    </div>
  );
};

export default ControlPanel;
