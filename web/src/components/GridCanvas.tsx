import React, { useRef, useEffect } from 'react';

export interface Position {
  x: number;
  y: number;
  timestamp_ms?: number;
}

export interface RobotStateUI {
  robot_id: string;
  port: string;
  color: string;
  current_pos: Position;
  history: Position[];
  intended_pos: Position;
  target_pos: Position;
  battery_pct: number;
  status: string;
  is_online: boolean;
  tasks_completed: number;
}

export interface GridCanvasProps {
  robots: Record<string, RobotStateUI>;
  blockedAisles: Array<{ x: number; y: number }>;
  gridSize?: number; // default 10
}

const STATUS_COLORS: Record<string, string> = {
  MOVING: '#22d3ee',
  YIELDING: '#f59e0b',
  REPLANNING: '#a855f7',
  OFFLINE_SIMULATED: '#475569',
  DELIVERING: '#10b981',
};

const SHELF_A = { x: '20%', y: '15%', w: '14%', h: '65%' };
const SHELF_B = { x: '66%', y: '15%', w: '14%', h: '65%' };

export const GridCanvas: React.FC<GridCanvasProps> = ({
  robots,
  blockedAisles,
  gridSize = 10,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  // Coordinate mapper: grid units (0-10) → SVG % (0-100)
  const toSVG = (v: number) => (v / gridSize) * 100;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className="w-full h-full"
      style={{ display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* ── Background ── */}
      <rect x="0" y="0" width="100" height="100" fill="#0f172a" rx="0" />

      {/* ── Grid Lines ── */}
      {Array.from({ length: gridSize + 1 }, (_, i) => {
        const pos = (i / gridSize) * 100;
        return (
          <React.Fragment key={i}>
            <line
              x1={pos} y1="0" x2={pos} y2="100"
              stroke="#1e293b" strokeWidth="0.5"
              opacity={i % gridSize === 0 ? '1' : '0.7'}
            />
            <line
              x1="0" y1={pos} x2="100" y2={pos}
              stroke="#1e293b" strokeWidth="0.5"
              opacity={i % gridSize === 0 ? '1' : '0.7'}
            />
          </React.Fragment>
        );
      })}

      {/* ── Grid coordinate labels ── */}
      {[0, 2, 4, 6, 8, 10].map((v) => (
        <React.Fragment key={v}>
          <text x={toSVG(v) + 0.5} y="2.5" fill="#334155" fontSize="2" fontFamily="monospace">{v}</text>
          <text x="0.5" y={toSVG(v) + 0.8} fill="#334155" fontSize="2" fontFamily="monospace">{v}</text>
        </React.Fragment>
      ))}

      {/* ── Shelf Aisle A ── */}
      <rect
        x="20" y="15" width="14" height="65"
        fill="#1e293b" stroke="#334155" strokeWidth="0.8" rx="1"
      />
      <text
        x="27" y="55" fill="#475569" fontSize="2.2" fontFamily="monospace" fontWeight="bold"
        textAnchor="middle"
        transform="rotate(-90, 27, 55)"
        letterSpacing="0.5"
      >
        SHELF A
      </text>

      {/* ── Shelf Aisle B ── */}
      <rect
        x="66" y="15" width="14" height="65"
        fill="#1e293b" stroke="#334155" strokeWidth="0.8" rx="1"
      />
      <text
        x="73" y="55" fill="#475569" fontSize="2.2" fontFamily="monospace" fontWeight="bold"
        textAnchor="middle"
        transform="rotate(-90, 73, 55)"
        letterSpacing="0.5"
      >
        SHELF B
      </text>

      {/* ── Docking Stations ── */}
      {[
        { x: 1, y: 1, label: 'S1' },
        { x: 5, y: 1, label: 'S2' },
        { x: 9, y: 1, label: 'S3' },
        { x: 1, y: 9, label: 'D1' },
        { x: 5, y: 9, label: 'D2' },
        { x: 9, y: 9, label: 'D3' },
      ].map((s) => (
        <g key={s.label}>
          <rect
            x={toSVG(s.x) - 3} y={toSVG(s.y) - 3} width="6" height="6"
            fill="#0f2d1e" stroke="#10b981" strokeWidth="0.6" rx="1"
          />
          <text x={toSVG(s.x)} y={toSVG(s.y) + 0.8} fill="#10b981" fontSize="1.8" textAnchor="middle" fontFamily="monospace" fontWeight="bold">{s.label}</text>
        </g>
      ))}

      {/* ── Blocked Aisles ── */}
      {blockedAisles.map((aisle, idx) => (
        <g key={idx}>
          <rect
            x={toSVG(aisle.x) - 5} y={toSVG(aisle.y) - 5}
            width="10" height="10"
            fill="rgba(220, 38, 38, 0.25)" stroke="#ef4444" strokeWidth="0.8" rx="1"
            strokeDasharray="2 1"
          >
            <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
          </rect>
          <text
            x={toSVG(aisle.x)} y={toSVG(aisle.y) + 0.8}
            fill="#ef4444" fontSize="3" textAnchor="middle" fontFamily="monospace" fontWeight="bold"
          >
            ⛔
          </text>
          <text
            x={toSVG(aisle.x)} y={toSVG(aisle.y) + 4}
            fill="#fca5a5" fontSize="1.5" textAnchor="middle" fontFamily="monospace"
          >
            BLOCKED
          </text>
        </g>
      ))}

      {/* ── Robots ── */}
      {Object.values(robots).map((bot) => {
        const isOffline = bot.status === 'OFFLINE_SIMULATED' || !bot.is_online;
        const isYielding = bot.status === 'YIELDING';
        const isReplanning = bot.status === 'REPLANNING';
        const cx = toSVG(bot.current_pos.x);
        const cy = toSVG(bot.current_pos.y);
        const ringColor = isOffline ? '#475569' : isYielding ? '#f59e0b' : isReplanning ? '#a855f7' : bot.color;

        return (
          <g key={bot.robot_id}>
            {/* ── Target waypoint indicator ── */}
            {!isOffline && bot.target_pos && (
              <g opacity="0.5">
                <circle
                  cx={toSVG(bot.target_pos.x)}
                  cy={toSVG(bot.target_pos.y)}
                  r="2"
                  fill="none"
                  stroke={bot.color}
                  strokeWidth="0.5"
                  strokeDasharray="1.5 1"
                />
                <line
                  x1={cx}
                  y1={cy}
                  x2={toSVG(bot.target_pos.x)}
                  y2={toSVG(bot.target_pos.y)}
                  stroke={bot.color}
                  strokeWidth="0.3"
                  strokeDasharray="1.5 1.5"
                  opacity="0.3"
                />
              </g>
            )}

            {/* ── Intended position arrow head ── */}
            {!isOffline && bot.intended_pos && (
              <circle
                cx={toSVG(bot.intended_pos.x)}
                cy={toSVG(bot.intended_pos.y)}
                r="1"
                fill={bot.color}
                opacity="0.4"
              />
            )}

            {/* ── History trail (fading breadcrumbs) ── */}
            {!isOffline &&
              bot.history.map((pos, i) => (
                <circle
                  key={i}
                  cx={toSVG(pos.x)}
                  cy={toSVG(pos.y)}
                  r={2.0 - i * 0.35}
                  fill={bot.color}
                  opacity={(5 - i) * 0.12}
                />
              ))}

            {/* ── Conflict/yield glow ring ── */}
            {!isOffline && (isYielding || isReplanning) && (
              <circle cx={cx} cy={cy} r="5" fill="none" stroke={ringColor} strokeWidth="0.6" opacity="0.6">
                <animate attributeName="r" values="4;7;4" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1s" repeatCount="indefinite" />
              </circle>
            )}

            {/* ── Robot body ── */}
            <rect
              x={cx - 3.5} y={cy - 3.5}
              width="7" height="7"
              fill={isOffline ? '#1e293b' : bot.color}
              stroke={ringColor}
              strokeWidth="0.8"
              rx="1.5"
              opacity={isOffline ? 0.4 : 1}
              style={{ transition: 'all 0.18s ease-out' }}
            />

            {/* ── Robot label ── */}
            <text
              x={cx} y={cy + 1}
              fill="white"
              fontSize="2.2"
              textAnchor="middle"
              fontFamily="monospace"
              fontWeight="bold"
            >
              {bot.robot_id.replace('AMR-', '')}
            </text>

            {/* ── Status indicator dot ── */}
            <circle
              cx={cx + 3}
              cy={cy - 3}
              r="1.2"
              fill={STATUS_COLORS[bot.status] || '#94a3b8'}
            >
              {!isOffline && (
                <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
              )}
            </circle>

            {/* ── Battery bar ── */}
            {!isOffline && (
              <g>
                <rect x={cx - 3.5} y={cy + 4.5} width="7" height="1" fill="#1e293b" rx="0.5" />
                <rect
                  x={cx - 3.5}
                  y={cy + 4.5}
                  width={7 * (bot.battery_pct / 100)}
                  height="1"
                  fill={bot.battery_pct > 50 ? '#22c55e' : bot.battery_pct > 25 ? '#f59e0b' : '#ef4444'}
                  rx="0.5"
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default GridCanvas;
