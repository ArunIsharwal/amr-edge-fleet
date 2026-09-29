import React, { useRef } from 'react';

export const GRID_WIDTH = 18;  // Full widescreen width
export const GRID_HEIGHT = 10; // Standard warehouse height

// Re-distributed 3x2 shelf rack matrix utilizing the full 18m width with 3.0m+ wide corridors
export const SHELVES = [
  // West Bay (Left)
  { id: 'R1', x: 3.0, y: 2.0, w: 1.6, h: 1.6 },
  { id: 'R2', x: 3.0, y: 6.4, w: 1.6, h: 1.6 },
  // Central Bay (Middle)
  { id: 'R3', x: 8.2, y: 2.0, w: 1.6, h: 1.6 },
  { id: 'R4', x: 8.2, y: 6.4, w: 1.6, h: 1.6 },
  // East Bay (Right)
  { id: 'R5', x: 13.4, y: 2.0, w: 1.6, h: 1.6 },
  { id: 'R6', x: 13.4, y: 6.4, w: 1.6, h: 1.6 },
];

export function isInsideShelf(x, y, buffer = 0.25) {
  return SHELVES.some(
    (s) =>
      x >= s.x - buffer &&
      x <= s.x + s.w + buffer &&
      y >= s.y - buffer &&
      y <= s.y + s.h + buffer
  );
}

// Snaps coordinates to the nearest open aisle if clicked inside a shelf
export function snapToFreeCorridor(x, y) {
  if (!isInsideShelf(x, y, 0.25)) return { x, y };

  const offsets = [
    { dx: 0, dy: -1.8 },
    { dx: 0, dy: 1.8 },
    { dx: -1.8, dy: 0 },
    { dx: 1.8, dy: 0 },
  ];

  for (const o of offsets) {
    const nx = Math.max(0.6, Math.min(GRID_WIDTH - 0.6, x + o.dx));
    const ny = Math.max(0.6, Math.min(GRID_HEIGHT - 0.6, y + o.dy));
    if (!isInsideShelf(nx, ny, 0.65)) {
      return { x: parseFloat(nx.toFixed(1)), y: parseFloat(ny.toFixed(1)) };
    }
  }
  return { x: 6.0, y: 5.0 };
}

const STATUS_COLORS = {
  IDLE: '#64748b',
  NAVIGATING_PICKUP: '#38bdf8',
  DELIVERING: '#fbbf24',
  YIELDING: '#c084fc',
  REPLANNING: '#f43f5e',
  OFFLINE_SIMULATED: '#334155',
};

export const GridCanvas = ({
  robots = {},
  blockedAisles = [],
  onCanvasClick,
  customGoal,
  selectedBotId,
}) => {
  const svgRef = useRef(null);

  // Scaled coordinates to fit viewBox "0 0 180 100"
  const toSVGX = (x) => (x / GRID_WIDTH) * 180;
  const toSVGY = (y) => (y / GRID_HEIGHT) * 100;

  const handleClick = (e) => {
    if (!svgRef.current || !onCanvasClick) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * GRID_WIDTH;
    const clickY = ((e.clientY - rect.top) / rect.height) * GRID_HEIGHT;

    onCanvasClick(
      parseFloat(Math.max(0.6, Math.min(GRID_WIDTH - 0.6, clickX)).toFixed(2)),
      parseFloat(Math.max(0.6, Math.min(GRID_HEIGHT - 0.6, clickY)).toFixed(2))
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 180 100"
      preserveAspectRatio="none"
      className="w-full h-full cursor-crosshair select-none bg-slate-950 block"
      onClick={handleClick}
    >
      {/* Background Floor */}
      <rect x="0" y="0" width="180" height="100" fill="#060913" />

      {/* Grid Lines */}
      {Array.from({ length: GRID_WIDTH + 1 }, (_, i) => {
        const posX = (i / GRID_WIDTH) * 180;
        const isMajor = i % 2 === 0;
        return (
          <line
            key={`v-${i}`}
            x1={posX}
            y1="0"
            x2={posX}
            y2="100"
            stroke={isMajor ? '#1e293b' : '#0f172a'}
            strokeWidth={isMajor ? '0.5' : '0.25'}
          />
        );
      })}

      {Array.from({ length: GRID_HEIGHT + 1 }, (_, i) => {
        const posY = (i / GRID_HEIGHT) * 100;
        const isMajor = i % 2 === 0;
        return (
          <line
            key={`h-${i}`}
            x1="0"
            y1={posY}
            x2="180"
            y2={posY}
            stroke={isMajor ? '#1e293b' : '#0f172a'}
            strokeWidth={isMajor ? '0.5' : '0.25'}
          />
        );
      })}

      {/* Warehouse Shelves */}
      {SHELVES.map((s) => (
        <g key={s.id}>
          <rect
            x={toSVGX(s.x)}
            y={toSVGY(s.y)}
            width={(s.w / GRID_WIDTH) * 180}
            height={(s.h / GRID_HEIGHT) * 100}
            fill="#0f172a"
            stroke="#334155"
            strokeWidth="0.8"
            rx="1.5"
          />
          <text
            x={toSVGX(s.x + s.w / 2)}
            y={toSVGY(s.y + s.h / 2) + 1.2}
            fill="#64748b"
            fontSize="2.4"
            fontFamily="monospace"
            fontWeight="black"
            textAnchor="middle"
          >
            {s.id}
          </text>
        </g>
      ))}

      {/* Blocked Aisles */}
      {blockedAisles.map((aisle, idx) => (
        <g key={idx}>
          <rect
            x={toSVGX(aisle.x) - 4}
            y={toSVGY(aisle.y) - 4}
            width="8"
            height="8"
            fill="rgba(239, 68, 68, 0.2)"
            stroke="#ef4444"
            strokeWidth="0.8"
            rx="1"
          />
          <text x={toSVGX(aisle.x)} y={toSVGY(aisle.y) + 1.2} fill="#ef4444" fontSize="3.5" textAnchor="middle">
            ⛔
          </text>
        </g>
      ))}

      {/* Task Pickup & Dropoff Visual Pins */}
      {Object.values(robots).map((bot) => {
        if (!bot.current_task) return null;
        const pk = bot.current_task.pickup;
        const dp = bot.current_task.dropoff;

        return (
          <g key={`task-pins-${bot.robot_id}`}>
            {/* Dashed line connecting pickup and dropoff */}
            <line
              x1={toSVGX(pk.x)}
              y1={toSVGY(pk.y)}
              x2={toSVGX(dp.x)}
              y2={toSVGY(dp.y)}
              stroke={bot.color}
              strokeWidth="0.4"
              strokeDasharray="1 1"
              opacity="0.4"
            />
            {/* Pickup Marker P */}
            <circle cx={toSVGX(pk.x)} cy={toSVGY(pk.y)} r="2.2" fill="#38bdf8" fillOpacity="0.25" stroke="#38bdf8" strokeWidth="0.6" />
            <text x={toSVGX(pk.x)} y={toSVGY(pk.y) + 0.8} fill="#ffffff" fontSize="2" fontWeight="black" textAnchor="middle" fontFamily="monospace">
              P
            </text>
            {/* Dropoff Marker D */}
            <circle cx={toSVGX(dp.x)} cy={toSVGY(dp.y)} r="2.2" fill="#fbbf24" fillOpacity="0.25" stroke="#fbbf24" strokeWidth="0.6" />
            <text x={toSVGX(dp.x)} y={toSVGY(dp.y) + 0.8} fill="#ffffff" fontSize="2" fontWeight="black" textAnchor="middle" fontFamily="monospace">
              D
            </text>
          </g>
        );
      })}

      {/* Planned Space-Time A* Trajectories */}
      {Object.values(robots).map((bot) => {
        if (!bot.is_online || !bot.path || bot.path.length === 0) return null;
        const allPoints = [{ x: bot.current_pos.x, y: bot.current_pos.y }, ...bot.path];
        const pointsStr = allPoints.map((p) => `${toSVGX(p.x)},${toSVGY(p.y)}`).join(' ');

        return (
          <polyline
            key={`path-${bot.robot_id}`}
            points={pointsStr}
            fill="none"
            stroke={bot.color}
            strokeWidth="0.75"
            strokeDasharray="1.5 1.5"
            opacity="0.8"
          />
        );
      })}

      {/* Custom Selected Goal Marker */}
      {customGoal && (
        <g>
          <circle cx={toSVGX(customGoal.x)} cy={toSVGY(customGoal.y)} r="3.5" fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="1.5 1.5" />
          <circle cx={toSVGX(customGoal.x)} cy={toSVGY(customGoal.y)} r="1.2" fill="#f59e0b" />
          <text x={toSVGX(customGoal.x)} y={toSVGY(customGoal.y) + 5.5} fill="#f59e0b" fontSize="2.4" fontWeight="black" textAnchor="middle">
            GOAL
          </text>
        </g>
      )}

      {/* Robot Rounded Square Box (No large dashed circles) */}
      {Object.values(robots).map((bot) => {
        const isOffline = bot.status === 'OFFLINE_SIMULATED' || !bot.is_online;
        const cx = toSVGX(bot.current_pos.x);
        const cy = toSVGY(bot.current_pos.y);
        const isSelected = selectedBotId === bot.robot_id;

        return (
          <g key={bot.robot_id}>
            {/* Robot 0.8m x 0.8m Rounded Square Body */}
            <rect
              x={cx - 3.2}
              y={cy - 3.2}
              width="6.4"
              height="6.4"
              fill={isOffline ? '#334155' : bot.color}
              stroke={isSelected ? '#ffffff' : '#0f172a'}
              strokeWidth={isSelected ? '1.0' : '0.4'}
              rx="1.4"
            />

            <text x={cx} y={cy + 0.9} fill="#ffffff" fontSize="2.3" fontWeight="black" textAnchor="middle" fontFamily="monospace">
              {bot.robot_id.replace('AMR-', '')}
            </text>

            {/* Status dot */}
            <circle cx={cx + 2.3} cy={cy - 2.3} r="0.8" fill={STATUS_COLORS[bot.status] || '#64748b'} />
          </g>
        );
      })}
    </svg>
  );
};

export default GridCanvas;