export type Point2 = readonly [number, number];

export interface FootprintBuilding {
  readonly footprint: readonly Point2[];
  readonly height: number;
}

export interface PlanGridOptions {
  readonly cellSize: number;
  readonly padding: number;
  readonly inflate: number;
  readonly cruiseAltitude: number;
  readonly clearance: number;
}

export interface PlanGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly origin: Point2;
  readonly blocked: Uint8Array;
  readonly heights: Float32Array;
  readonly obstacleBuildings: number;
}

export const DEFAULT_GRID_OPTIONS: PlanGridOptions = {
  cellSize: 10,
  padding: 320,
  inflate: 8,
  cruiseAltitude: 50,
  clearance: 12,
};

const pointInRing = (point: Point2, ring: readonly Point2[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1];
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const segmentDistanceSquared = (point: Point2, a: Point2, b: Point2): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = point[0] - a[0];
    const py = point[1] - a[1];
    return px * px + py * py;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
  );
  const px = point[0] - (a[0] + t * dx);
  const py = point[1] - (a[1] + t * dy);
  return px * px + py * py;
};

const ringDistanceSquared = (point: Point2, ring: readonly Point2[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const distance = segmentDistanceSquared(point, a, b);
    if (distance < best) best = distance;
  }
  return best;
};

export const buildPlanGrid = (
  buildings: readonly FootprintBuilding[],
  start: Point2,
  goal: Point2,
  options: Partial<PlanGridOptions> = {},
): PlanGrid => {
  const config: PlanGridOptions = {
    cellSize: options.cellSize ?? DEFAULT_GRID_OPTIONS.cellSize,
    padding: options.padding ?? DEFAULT_GRID_OPTIONS.padding,
    inflate: options.inflate ?? DEFAULT_GRID_OPTIONS.inflate,
    cruiseAltitude: options.cruiseAltitude ?? DEFAULT_GRID_OPTIONS.cruiseAltitude,
    clearance: options.clearance ?? DEFAULT_GRID_OPTIONS.clearance,
  };
  const minX = Math.min(start[0], goal[0]) - config.padding;
  const maxX = Math.max(start[0], goal[0]) + config.padding;
  const minY = Math.min(start[1], goal[1]) - config.padding;
  const maxY = Math.max(start[1], goal[1]) + config.padding;

  const width = Math.ceil((maxX - minX) / config.cellSize) + 1;
  const height = Math.ceil((maxY - minY) / config.cellSize) + 1;
  const blocked = new Uint8Array(width * height);
  const heights = new Float32Array(width * height);
  const origin: Point2 = [minX, minY];
  const threshold = config.cruiseAltitude - config.clearance;
  const inflateSquared = config.inflate * config.inflate;
  const centerX = (index: number): number => minX + (index + 0.5) * config.cellSize;
  const centerY = (index: number): number => minY + (index + 0.5) * config.cellSize;

  let obstacleBuildings = 0;
  for (const building of buildings) {
    if (building.footprint.length < 3) continue;
    if (building.height < threshold) continue;

    let ringMinX = Number.POSITIVE_INFINITY;
    let ringMaxX = Number.NEGATIVE_INFINITY;
    let ringMinY = Number.POSITIVE_INFINITY;
    let ringMaxY = Number.NEGATIVE_INFINITY;
    for (const [x, y] of building.footprint) {
      if (x < ringMinX) ringMinX = x;
      if (x > ringMaxX) ringMaxX = x;
      if (y < ringMinY) ringMinY = y;
      if (y > ringMaxY) ringMaxY = y;
    }

    const i0 = Math.max(0, Math.floor((ringMinX - config.inflate - minX) / config.cellSize));
    const i1 = Math.min(width - 1, Math.ceil((ringMaxX + config.inflate - minX) / config.cellSize));
    const j0 = Math.max(0, Math.floor((ringMinY - config.inflate - minY) / config.cellSize));
    const j1 = Math.min(height - 1, Math.ceil((ringMaxY + config.inflate - minY) / config.cellSize));
    obstacleBuildings += 1;

    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const point: Point2 = [centerX(i), centerY(j)];
        const inside = pointInRing(point, building.footprint);
        const nearby = ringDistanceSquared(point, building.footprint) <= inflateSquared;
        if (!inside && !nearby) continue;
        const index = j * width + i;
        blocked[index] = 1;
        if (inside && building.height > heights[index]) {
          heights[index] = building.height;
        }
      }
    }
  }

  return {
    width,
    height,
    cellSize: config.cellSize,
    origin,
    blocked,
    heights,
    obstacleBuildings,
  };
};

export const cellIndex = (grid: PlanGrid, cellX: number, cellY: number): number => {
  const clampedX = Math.max(0, Math.min(grid.width - 1, cellX));
  const clampedY = Math.max(0, Math.min(grid.height - 1, cellY));
  return clampedY * grid.width + clampedX;
};

export const cellCenter = (grid: PlanGrid, index: number): Point2 => {
  const cellX = index % grid.width;
  const cellY = Math.floor(index / grid.width);
  return [
    grid.origin[0] + (cellX + 0.5) * grid.cellSize,
    grid.origin[1] + (cellY + 0.5) * grid.cellSize,
  ];
};

export const pointToCell = (grid: PlanGrid, point: Point2): number => {
  const cellX = Math.floor((point[0] - grid.origin[0]) / grid.cellSize);
  const cellY = Math.floor((point[1] - grid.origin[1]) / grid.cellSize);
  return cellIndex(grid, cellX, cellY);
};
