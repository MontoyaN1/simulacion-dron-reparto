import { cellCenter, type PlanGrid } from "./grid";

const SQRT2 = Math.SQRT2;

interface OpenNode {
  readonly index: number;
  readonly priority: number;
}

class MinHeap {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(index: number, priority: number): void {
    this.items.push({ index, priority });
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent].priority <= this.items[child].priority) break;
      [this.items[parent], this.items[child]] = [this.items[child], this.items[parent]];
      child = parent;
    }
  }

  pop(): OpenNode | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) return first;
    if (this.items.length === 0) return first;

    this.items[0] = last;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) {
        smallest = right;
      }
      if (smallest === parent) break;
      [this.items[parent], this.items[smallest]] = [this.items[smallest], this.items[parent]];
      parent = smallest;
    }
    return first;
  }
}

export interface GridPath {
  readonly indices: readonly number[];
  readonly visited: number;
  readonly found: boolean;
}

const octile = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
};

export const findGridPath = (grid: PlanGrid, start: number, goal: number): GridPath => {
  const total = grid.width * grid.height;
  const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap();

  const startX = start % grid.width;
  const startY = Math.floor(start / grid.width);
  const goalX = goal % grid.width;
  const goalY = Math.floor(goal / grid.width);

  gScore[start] = 0;
  open.push(start, octile(startX, startY, goalX, goalY));
  let visited = 0;

  const directions = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ] as const;

  while (open.size > 0) {
    const current = open.pop();
    if (!current || closed[current.index]) continue;
    const index = current.index;

    if (index === goal) {
      const indices: number[] = [];
      let cursor = goal;
      while (cursor !== -1) {
        indices.push(cursor);
        cursor = cameFrom[cursor];
      }
      indices.reverse();
      return { indices, visited, found: true };
    }

    closed[index] = 1;
    visited += 1;

    const cellX = index % grid.width;
    const cellY = Math.floor(index / grid.width);

    for (const [dx, dy, cost] of directions) {
      const nextX = cellX + dx;
      const nextY = cellY + dy;
      if (nextX < 0 || nextY < 0 || nextX >= grid.width || nextY >= grid.height) continue;

      const next = nextY * grid.width + nextX;
      if (closed[next] || grid.blocked[next]) continue;

      if (dx !== 0 && dy !== 0) {
        if (grid.blocked[cellY * grid.width + nextX]) continue;
        if (grid.blocked[nextY * grid.width + cellX]) continue;
      }

      const tentative = gScore[index] + cost;
      if (tentative >= gScore[next]) continue;

      gScore[next] = tentative;
      cameFrom[next] = index;
      open.push(next, tentative + octile(nextX, nextY, goalX, goalY));
    }
  }

  return { indices: [], visited, found: false };
};

const lineIsFree = (grid: PlanGrid, from: number, to: number): boolean => {
  const ax = (from % grid.width) + 0.5;
  const ay = Math.floor(from / grid.width) + 0.5;
  const bx = (to % grid.width) + 0.5;
  const by = Math.floor(to / grid.width) + 0.5;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = Math.floor(ax + (bx - ax) * ratio);
    const y = Math.floor(ay + (by - ay) * ratio);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
    if (grid.blocked[y * grid.width + x]) return false;
  }
  return true;
};

export const smoothGridPath = (grid: PlanGrid, indices: readonly number[]): number[] => {
  if (indices.length <= 2) return [...indices];
  const result: number[] = [indices[0]];
  let anchor = 0;

  while (anchor < indices.length - 1) {
    let next = anchor + 1;
    for (let candidate = indices.length - 1; candidate > anchor; candidate -= 1) {
      if (lineIsFree(grid, indices[anchor], indices[candidate])) {
        next = candidate;
        break;
      }
    }
    result.push(indices[next]);
    anchor = next;
  }

  return result;
};

export const pathPoints = (grid: PlanGrid, indices: readonly number[]): [number, number][] =>
  indices.map((index) => [cellCenter(grid, index)[0], cellCenter(grid, index)[1]]);

