import { seededRandom } from './random';

/**
 * 迷路(完全迷路: どの2マスの間にも道がちょうど1本ある)と、両端からの幅優先探索。three.js には依存しない。
 * マスの番号は c = x + y × w。
 */

export interface Maze {
  readonly w: number;
  readonly h: number;
  /** 各マスから通れる隣のマス */
  readonly open: readonly (readonly number[])[];
}

/** 穴掘り法(深さ優先の再帰を、スタックで書いたもの)で迷路を作る */
export function carveMaze(w: number, h: number, seed: number): Maze {
  const random = seededRandom(seed);
  const open: number[][] = Array.from({ length: w * h }, () => []);
  const seen = new Uint8Array(w * h);
  seen[0] = 1;
  const stack = [0];
  while (stack.length > 0) {
    const c = stack[stack.length - 1] ?? 0;
    const x = c % w;
    const y = Math.floor(c / w);
    const next: number[] = [];
    if (x + 1 < w && seen[c + 1] === 0) next.push(c + 1);
    if (x > 0 && seen[c - 1] === 0) next.push(c - 1);
    if (y + 1 < h && seen[c + w] === 0) next.push(c + w);
    if (y > 0 && seen[c - w] === 0) next.push(c - w);
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(random() * next.length)] ?? 0;
    open[c]?.push(n);
    open[n]?.push(c);
    seen[n] = 1;
    stack.push(n);
  }
  return { w, h, open };
}

export function isOpen(maze: Maze, a: number, b: number): boolean {
  return maze.open[a]?.includes(b) ?? false;
}

export interface Search {
  /** 始点からの道のりの長さ(届かないマスは Infinity) */
  readonly dist: readonly number[];
  /** ひとつ手前のマス(始点は −1) */
  readonly parent: readonly number[];
}

/** 幅優先探索 */
export function breadthFirst(maze: Maze, start: number): Search {
  const n = maze.w * maze.h;
  const dist = Array.from({ length: n }, () => Infinity);
  const parent = Array.from({ length: n }, () => -1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] ?? 0;
    for (const next of maze.open[c] ?? []) {
      if (dist[next] === Infinity) {
        dist[next] = (dist[c] ?? 0) + 1;
        parent[next] = c;
        queue.push(next);
      }
    }
  }
  return { dist, parent };
}

/** parent をたどって、from から始点までのマスの列を返す */
function walkBack(parent: readonly number[], from: number): number[] {
  const cells = [from];
  for (let c = parent[from] ?? -1; c >= 0; c = parent[c] ?? -1) cells.push(c);
  return cells;
}

export interface Meeting {
  /** 2つの探索が出会うマス */
  readonly cell: number;
  /** 出会うまでの探索の深さ(両方の探索が同じ速さで1マスずつ広がるとき) */
  readonly step: number;
  /** a → 出会うマス → b の最短路 */
  readonly path: readonly number[];
  /** path のうち、出会うマスの位置(添字) */
  readonly meetIndex: number;
}

/**
 * 両端から同時に幅優先探索したとき、2つの探索が出会うマスと、そこを通る最短路。
 * 完全迷路なので最短路は1本で、出会うマスはその上の、両端からの道のりの大きい方が最小になるマス。
 */
export function meetInMiddle(maze: Maze, fromA: Search, fromB: Search): Meeting {
  let cell = 0;
  let step = Infinity;
  for (let c = 0; c < maze.w * maze.h; c++) {
    const s = Math.max(fromA.dist[c] ?? Infinity, fromB.dist[c] ?? Infinity);
    if (s < step) {
      step = s;
      cell = c;
    }
  }
  // 始点 a から出会うマスまで、出会うマスの次から始点 b まで
  const toA = walkBack(fromA.parent, cell).toReversed();
  const toB = walkBack(fromB.parent, cell).slice(1);
  return { cell, step, path: [...toA, ...toB], meetIndex: toA.length - 1 };
}
