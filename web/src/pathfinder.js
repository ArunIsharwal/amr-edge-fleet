import { isInsideShelf, GRID_WIDTH, GRID_HEIGHT } from './components/GridCanvas';

const GRID_RES = 0.5;
const SAFE_BUFFER = 0.65;

export function isObstacle(x, y, blockedAisles = []) {
  if (isInsideShelf(x, y, SAFE_BUFFER)) return true;
  for (const b of blockedAisles) {
    if (Math.hypot(x - b.x, y - b.y) < 1.0) return true;
  }
  return false;
}

export function findOptimizedPath(start, goal, blockedAisles = []) {
  const roundX = (v) => Math.max(0.6, Math.min(GRID_WIDTH - 0.6, Math.round(v / GRID_RES) * GRID_RES));
  const roundY = (v) => Math.max(0.6, Math.min(GRID_HEIGHT - 0.6, Math.round(v / GRID_RES) * GRID_RES));

  const startX = roundX(start.x);
  const startY = roundY(start.y);
  const goalX = roundX(goal.x);
  const goalY = roundY(goal.y);

  const startKey = `${startX.toFixed(1)},${startY.toFixed(1)}`;
  const goalKey = `${goalX.toFixed(1)},${goalY.toFixed(1)}`;

  const openSet = [{ x: startX, y: startY, g: 0, f: Math.hypot(goalX - startX, goalY - startY) }];
  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(startKey, 0);

  // Orthogonal exploration only
  const neighbors = [
    { dx: GRID_RES, dy: 0 },
    { dx: -GRID_RES, dy: 0 },
    { dx: 0, dy: GRID_RES },
    { dx: 0, dy: -GRID_RES },
  ];

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const curKey = `${current.x.toFixed(1)},${current.y.toFixed(1)}`;

    if (Math.hypot(current.x - goalX, current.y - goalY) < GRID_RES * 0.9) {
      const path = [{ x: goalX, y: goalY }];
      let curr = curKey;
      while (cameFrom.has(curr)) {
        const pt = cameFrom.get(curr);
        path.unshift({ x: pt.x, y: pt.y });
        curr = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      }
      return path;
    }

    for (const n of neighbors) {
      const nx = parseFloat((current.x + n.dx).toFixed(1));
      const ny = parseFloat((current.y + n.dy).toFixed(1));

      if (nx < 0.6 || nx > GRID_WIDTH - 0.6 || ny < 0.6 || ny > GRID_HEIGHT - 0.6) continue;
      if (isObstacle(nx, ny, blockedAisles)) continue;

      const neighborKey = `${nx.toFixed(1)},${ny.toFixed(1)}`;
      const tentativeG = (gScore.get(curKey) ?? Infinity) + GRID_RES;

      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        const h = Math.hypot(goalX - nx, goalY - ny);
        openSet.push({ x: nx, y: ny, g: tentativeG, f: tentativeG + h });
      }
    }
  }

  return [{ x: goal.x, y: goal.y }];
}