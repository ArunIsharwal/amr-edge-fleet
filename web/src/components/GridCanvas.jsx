import React, { useRef } from 'react';

export const GRID_WIDTH = 18;  // Full widescreen width
export const GRID_HEIGHT = 10; // Standard warehouse height

// Re-distributed 3x2 shelf rack matrix utilizing the full 18m width
export const SHELVES = [
  // West Bay (Left)
  { id: 'R1', x: 2.5, y: 1.5, w: 2.0, h: 2.0 },
  { id: 'R2', x: 2.5, y: 6.5, w: 2.0, h: 2.0 },
  // Central Bay (Middle)
  { id: 'R3', x: 8.0, y: 1.5, w: 2.0, h: 2.0 },
  { id: 'R4', x: 8.0, y: 6.5, w: 2.0, h: 2.0 },
  // East Bay (Right)
  { id: 'R5', x: 13.5, y: 1.5, w: 2.0, h: 2.0 },
  { id: 'R6', x: 13.5, y: 6.5, w: 2.0, h: 2.0 },
];

export function isInsideShelf(x, y, buffer = 0.65) {
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
  if (!isInsideShelf(x, y, 0.65)) return { x, y };

  const offsets = [
    { dx: 0, dy: -1.5 },
    { dx: 0, dy: 1.5 },
    { dx: -1.5, dy: 0 },
    { dx: 1.5, dy: 0 },
  ];

  for (const o of offsets) {
    const nx = Math.max(0.6, Math.min(GRID_WIDTH - 0.6, x + o.dx));
    const ny = Math.max(0.6, Math.min(GRID_HEIGHT - 0.6, y + o.dy));
    if (!isInsideShelf(nx, ny, 0.65)) {
      return { x: parseFloat(nx.toFixed(1)), y: parseFloat(ny.toFixed(1)) };
    }
  }
  return { x: 5.5, y: 4.8 };
}

const STATUS_COLORS = {
  MOVING: '#22d3ee',
  YIELDING: '#f59e0b',
  REPLANNING: '#a855f7',
  DELIVERED: '#10b981',
  OFFLINE_SIMULATED: '#475569',
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
      <rect x="0" y="0" width="180" height="100" fill="#090d16" />

      {/* Vertical Grid Lines (0 to 18m) */}
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
            stroke={isMajor ? '#334155' : '#1e293b'}
            strokeWidth={isMajor ? '0.6' : '0.3'}
          />
        );
      })}

      {/* Horizontal Grid Lines (0 to 10m) */}
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
            stroke={isMajor ? '#334155' : '#1e293b'}
            strokeWidth={isMajor ? '0.6' : '0.3'}
          />
        );
      })}

      {/* Warehouse Shelves Across Full Width */}
      {SHELVES.map((s) => (
        <g key={s.id}>
          <rect
            x={toSVGX(s.x)}
            y={toSVGY(s.y)}
            width={(s.w / GRID_WIDTH) * 180}
            height={(s.h / GRID_HEIGHT) * 100}
            fill="#1e293b"
            stroke="#475569"
            strokeWidth="0.8"
            rx="1.5"
          />
          <text
            x={toSVGX(s.x + s.w / 2)}
            y={toSVGY(s.y + s.h / 2) + 1.2}
            fill="#94a3b8"
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
            fill="rgba(239, 68, 68, 0.25)"
            stroke="#ef4444"
            strokeWidth="0.8"
            rx="1"
          />
          <text x={toSVGX(aisle.x)} y={toSVGY(aisle.y) + 1.2} fill="#ef4444" fontSize="3.5" textAnchor="middle">
            ⛔
          </text>
        </g>
      ))}

      {/* Goal Marker (Only visible when active) */}
      {customGoal && (
        <g>
          <circle cx={toSVGX(customGoal.x)} cy={toSVGY(customGoal.y)} r="3.2" fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="1.5 1.5" />
          <circle cx={toSVGX(customGoal.x)} cy={toSVGY(customGoal.y)} r="1" fill="#f59e0b" />
          <text x={toSVGX(customGoal.x)} y={toSVGY(customGoal.y) + 5.5} fill="#f59e0b" fontSize="2.4" fontWeight="black" textAnchor="middle">
            GOAL
          </text>
        </g>
      )}

      {/* Clean Robot Blocks (No Guidelines, Clean Solid Rectangles) */}
      {Object.values(robots).map((bot) => {
        const isOffline = bot.status === 'OFFLINE_SIMULATED' || !bot.is_online;
        const cx = toSVGX(bot.current_pos.x);
        const cy = toSVGY(bot.current_pos.y);
        const isSelected = selectedBotId === bot.robot_id;

        return (
          <g key={bot.robot_id}>
            <rect
              x={cx - 3.2}
              y={cy - 3.2}
              width="6.4"
              height="6.4"
              fill={isOffline ? '#334155' : bot.color}
              stroke={isSelected ? '#ffffff' : '#0f172a'}
              strokeWidth={isSelected ? '0.9' : '0.4'}
              rx="1.2"
            />
            <text x={cx} y={cy + 0.9} fill="#ffffff" fontSize="2.3" fontWeight="black" textAnchor="middle" fontFamily="monospace">
              {bot.robot_id.replace('AMR-', '')}
            </text>
            <circle cx={cx + 2.3} cy={cy - 2.3} r="0.8" fill={STATUS_COLORS[bot.status] || '#94a3b8'} />
          </g>
        );
      })}
    </svg>
  );
};

export default GridCanvas;