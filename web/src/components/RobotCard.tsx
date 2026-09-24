import React from 'react';
import type { RobotStateUI } from './GridCanvas';
import { Battery, Power, Cpu, Navigation, CheckCircle, Wifi, WifiOff } from 'lucide-react';

export interface RobotCardProps {
  bot: RobotStateUI;
  onTogglePower: (port: string, currentOnline: boolean) => void;
  backendLive: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  MOVING:           { label: '▶ MOVING',     bg: 'bg-emerald-500',  text: 'text-slate-950', border: 'border-emerald-400' },
  YIELDING:         { label: '⏸ YIELDING',   bg: 'bg-amber-500',    text: 'text-slate-950', border: 'border-amber-400' },
  REPLANNING:       { label: '↻ REROUTING',  bg: 'bg-purple-500',   text: 'text-white',     border: 'border-purple-400' },
  OFFLINE_SIMULATED:{ label: '✕ OFFLINE',    bg: 'bg-slate-700',    text: 'text-slate-300', border: 'border-slate-600' },
  DELIVERING:       { label: '📦 DELIVERING', bg: 'bg-cyan-500',    text: 'text-slate-950', border: 'border-cyan-400' },
};

export const RobotCard: React.FC<RobotCardProps> = ({ bot, onTogglePower, backendLive }) => {
  const isOffline = bot.status === 'OFFLINE_SIMULATED' || !bot.is_online;
  const isYielding = bot.status === 'YIELDING';
  const isReplanning = bot.status === 'REPLANNING';
  const statusCfg = STATUS_CONFIG[bot.status] || STATUS_CONFIG.MOVING;
  const batteryColor =
    bot.battery_pct > 60 ? 'text-emerald-400' :
    bot.battery_pct > 30 ? 'text-amber-400' : 'text-red-400';
  const batteryBarColor =
    bot.battery_pct > 60 ? 'bg-emerald-500' :
    bot.battery_pct > 30 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div
      className={`p-2.5 rounded-xl border-2 transition-all duration-200 shadow-md ${
        isOffline
          ? 'bg-slate-900/30 border-slate-700/50 opacity-60'
          : isYielding
          ? 'bg-amber-950/30 border-amber-500/70 shadow-amber-500/10'
          : isReplanning
          ? 'bg-purple-950/30 border-purple-500/70 shadow-purple-500/10'
          : 'bg-slate-900/70 border-slate-700/70'
      }`}
    >
      {/* Header Row */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0 shadow"
            style={{ backgroundColor: isOffline ? '#475569' : bot.color }}
          />
          <span className="font-black text-sm text-white tracking-wide">{bot.robot_id}</span>
          <span className="text-[10px] text-slate-500 font-mono">:{bot.port}</span>
          {/* Backend indicator */}
          {backendLive ? (
            <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
              <Wifi className="w-2.5 h-2.5" />live
            </span>
          ) : (
            <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
              <WifiOff className="w-2.5 h-2.5" />sim
            </span>
          )}
        </div>

        <span
          className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border} ${
            (isYielding || isReplanning) ? 'animate-pulse' : ''
          }`}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* Position Grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div className="bg-slate-950/80 p-1.5 rounded-lg border border-slate-800">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider flex items-center gap-1">
            <Navigation className="w-2.5 h-2.5" />Current
          </div>
          <div className="font-mono text-[11px] font-black text-cyan-300">
            ({bot.current_pos.x.toFixed(1)}, {bot.current_pos.y.toFixed(1)})
          </div>
        </div>
        <div className="bg-slate-950/80 p-1.5 rounded-lg border border-slate-800">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Target</div>
          <div className="font-mono text-[11px] font-black text-slate-300">
            ({(bot.target_pos?.x ?? 0).toFixed(1)}, {(bot.target_pos?.y ?? 0).toFixed(1)})
          </div>
        </div>
      </div>

      {/* Battery + Tasks */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Battery className="w-3.5 h-3.5 text-slate-400" />
            <span className={`text-[11px] font-bold ${batteryColor}`}>
              {bot.battery_pct.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <CheckCircle className="w-3 h-3 text-cyan-500" />
            <span className="font-mono font-bold text-cyan-400">{bot.tasks_completed}</span>
            <span>tasks</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <Cpu className="w-3 h-3" />
            <span className="font-mono font-black">12MB</span>
          </div>
        </div>
        <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${batteryBarColor}`}
            style={{ width: `${bot.battery_pct}%` }}
          />
        </div>
      </div>

      {/* Trail history micro-viz */}
      <div className="mb-2 flex items-center gap-1">
        <span className="text-[9px] text-slate-600 font-bold uppercase">Trail:</span>
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: i < bot.history.length ? bot.color : '#1e293b',
              opacity: i < bot.history.length ? (5 - i) / 5 : 0.3,
            }}
          />
        ))}
        <span className="text-[9px] text-slate-600 ml-1">{bot.history.length}/5pts</span>
      </div>

      {/* Power Toggle */}
      <button
        onClick={() => onTogglePower(bot.port, !isOffline)}
        className={`w-full py-1.5 rounded-lg font-black text-[10px] transition-all uppercase tracking-wider flex items-center justify-center gap-1.5 shadow ${
          isOffline
            ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
            : 'bg-red-900/80 hover:bg-red-800 text-red-200 border border-red-700'
        }`}
      >
        <Power className="w-3 h-3" />
        {isOffline ? 'Re-enable Node (0-RTT)' : 'Kill Node — Simulate Wi-Fi Drop'}
      </button>
    </div>
  );
};

export default RobotCard;
