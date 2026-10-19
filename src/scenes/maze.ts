import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { LineBuilder } from '../gfx/lines';
import { seededRandom } from '../sim/random';
import { DynamicLine, Fader, PALETTE, Y_INK, defineScene, easeInOutCubic, floorLabel, progress, setText, stageFloor, standLabel } from './kit';

/**
 * #16 囚われたシミュレーション: 机の上の立体迷路を、両端の2つの光点から幅優先探索(BFS)で探る。
 * 探索済みのマスと壁が、始点からの距離(ポテンシャル)に応じて光る。2つの探索が出会うと最短路が光り、光点がそこへ集まる。
 * 2小節を想定。
 */

const W = 15;
const H = 11;
const CELL = 0.02;
const WALL_HEIGHT = 0.012;
/** 探索が出会うまでの区間 [拍] */
const SEARCH: readonly [number, number] = [0.5, 4.5];
const MEET_TO_PATH: readonly [number, number] = [4.5, 5.5];
const GATHER: readonly [number, number] = [5.5, 7];

type Cell = number;
const cellOf = (x: number, y: number): Cell => x + y * W;
const center = (c: Cell): Vector3 => new Vector3((c % W - (W - 1) / 2) * CELL, Y_INK, (Math.floor(c / W) - (H - 1) / 2) * CELL);

/** 穴掘り法(深さ優先)で迷路を作る。戻り値は各マスから通れる隣のマス */
function carve(seed: number): Cell[][] {
  const random = seededRandom(seed);
  const open: Cell[][] = Array.from({ length: W * H }, () => []);
  const seen = new Set<Cell>([0]);
  const stack: Cell[] = [0];
  while (stack.length > 0) {
    const c = stack[stack.length - 1] ?? 0;
    const x = c % W;
    const y = Math.floor(c / W);
    const next = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]
      .filter(([nx = 0, ny = 0]) => nx >= 0 && nx < W && ny >= 0 && ny < H && !seen.has(cellOf(nx, ny)))
      .map(([nx = 0, ny = 0]) => cellOf(nx, ny));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(random() * next.length)] ?? 0;
    open[c]?.push(n);
    open[n]?.push(c);
    seen.add(n);
    stack.push(n);
  }
  return open;
}

/** 幅優先探索。各マスの距離と、ひとつ手前のマス */
function bfs(open: Cell[][], start: Cell): { dist: number[]; parent: number[] } {
  const dist = Array.from({ length: W * H }, () => Infinity);
  const parent = Array.from({ length: W * H }, () => -1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] ?? 0;
    for (const n of open[c] ?? []) {
      if (dist[n] === Infinity) {
        dist[n] = (dist[c] ?? 0) + 1;
        parent[n] = c;
        queue.push(n);
      }
    }
  }
  return { dist, parent };
}

export const maze = defineScene('maze', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader, 0.5));

  const open = carve(16);
  const A: Cell = 0;
  const B: Cell = W * H - 1;
  const fromA = bfs(open, A);
  const fromB = bfs(open, B);
  // 2つの探索が出会うマス(両方からの距離の大きい方が最小になるマス)
  let meet = A;
  let meetStep = Infinity;
  for (let c = 0; c < W * H; c++) {
    const step = Math.max(fromA.dist[c] ?? Infinity, fromB.dist[c] ?? Infinity);
    if (step < meetStep) {
      meetStep = step;
      meet = c;
    }
  }
  // 最短路(A → 出会うマス → B)
  const walk = (parent: number[], from: Cell): Cell[] => {
    const cells = [from];
    while ((parent[cells[cells.length - 1] ?? 0] ?? -1) >= 0) cells.push(parent[cells[cells.length - 1] ?? 0] ?? 0);
    return cells;
  };
  const halfA = walk(fromA.parent, meet).toReversed();
  const halfB = walk(fromB.parent, meet).toReversed();

  // 壁: 隣のマスと通じていない辺。上端の線は、隣のマスの距離に応じて色を変える
  const walls: { a: Vector3; b: Vector3; cells: Cell[] }[] = [];
  const half = CELL / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellOf(x, y);
      const p = center(c);
      if (x === W - 1 || !open[c]?.includes(cellOf(x + 1, y))) {
        walls.push({ a: p.clone().add(new Vector3(half, 0, -half)), b: p.clone().add(new Vector3(half, 0, half)), cells: x === W - 1 ? [c] : [c, cellOf(x + 1, y)] });
      }
      if (y === H - 1 || !open[c]?.includes(cellOf(x, y + 1))) {
        walls.push({ a: p.clone().add(new Vector3(-half, 0, half)), b: p.clone().add(new Vector3(half, 0, half)), cells: y === H - 1 ? [c] : [c, cellOf(x, y + 1)] });
      }
      if (x === 0) walls.push({ a: p.clone().add(new Vector3(-half, 0, -half)), b: p.clone().add(new Vector3(-half, 0, half)), cells: [c] });
      if (y === 0) walls.push({ a: p.clone().add(new Vector3(-half, 0, -half)), b: p.clone().add(new Vector3(half, 0, -half)), cells: [c] });
    }
  }
  const base = new LineBuilder();
  for (const { a, b } of walls) {
    base.segment(a, b);
    base.segment(a, a.clone().setY(WALL_HEIGHT));
  }
  root.add(base.build(fader.line(PALETTE.dim, 0.45)));
  const topArray = new Float32Array(walls.flatMap(({ a, b }) => [a.x, WALL_HEIGHT, a.z, b.x, WALL_HEIGHT, b.z]));
  const topColors = new BufferAttribute(new Float32Array(walls.length * 6), 3);
  topColors.setUsage(DynamicDrawUsage);
  const topGeometry = new BufferGeometry();
  topGeometry.setAttribute('position', new BufferAttribute(topArray, 3));
  topGeometry.setAttribute('color', topColors);
  const topMaterial = fader.line(0xffffff, 1);
  topMaterial.vertexColors = true;
  root.add(new LineSegments(topGeometry, topMaterial));

  // 探索済みのマス(床のタイル)
  const tiles = new InstancedMesh(
    new PlaneGeometry(CELL * 0.82, CELL * 0.82).rotateX(-Math.PI / 2),
    fader.add(new MeshBasicMaterial({ color: 0xffffff, opacity: 0.55, depthWrite: false })),
    W * H,
  );
  tiles.frustumCulled = false;
  root.add(tiles);

  // 最短路と、集まる2つの光点
  const path = [...halfA, ...halfB.slice(0, -1).toReversed()].map((c) => center(c).setY(0.004));
  const pathLine = new DynamicLine(path.length, fader.line(PALETTE.warm, 1));
  root.add(pathLine.line);
  const lightPositions = new BufferAttribute(new Float32Array(6), 3);
  lightPositions.setUsage(DynamicDrawUsage);
  const lightGeometry = new BufferGeometry();
  lightGeometry.setAttribute('position', lightPositions);
  const lights = new Points(lightGeometry, fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.009, depthWrite: false })));
  lights.frustumCulled = false;
  root.add(lights);

  const corner = center(A);
  root.add(floorLabel(fader, 'A', corner.x - CELL, corner.z, { size: 0.007, color: PALETTE.cyan }));
  const cornerB = center(B);
  root.add(floorLabel(fader, 'B', cornerB.x + CELL, cornerB.z, { size: 0.007, color: PALETTE.warm }));
  const readout = standLabel(fader, '', -0.19, 0.012, -0.135, { anchorX: 'left', anchorY: 'bottom', size: 0.0065, color: PALETTE.glow });
  root.add(readout);

  const colorA = new Color(PALETTE.cyan);
  const colorB = new Color(PALETTE.warm);
  const colorDim = new Color(PALETTE.idle);
  const color = new Color();
  const matrix = new Matrix4();
  const hidden = new Matrix4().makeScale(1e-4, 1e-4, 1e-4);
  /** 近い方の始点からの距離 */
  const distance = (c: Cell): number => Math.min(fromA.dist[c] ?? Infinity, fromB.dist[c] ?? Infinity);
  /** 探索の進み s のときの、マス c の色(未到達なら null)。返す Color は使い回すので、すぐに使うこと */
  const shade = (c: Cell, s: number): Color | null => {
    const da = fromA.dist[c] ?? Infinity;
    const db = fromB.dist[c] ?? Infinity;
    const d = Math.min(da, db);
    if (d > s) return null;
    // 探索の最前線ほど明るい(ポテンシャルの勾配)
    return color.copy(colorDim).lerp(da <= db ? colorA : colorB, Math.exp(-(s - d) / 5));
  };

  return {
    root,
    fader,
    update(beat) {
      const s = meetStep * progress(beat, SEARCH);
      for (let c = 0; c < W * H; c++) {
        const tint = shade(c, s);
        if (tint === null) {
          tiles.setMatrixAt(c, hidden);
        } else {
          tiles.setMatrixAt(c, matrix.makeTranslation(center(c)));
          tiles.setColorAt(c, tint);
        }
      }
      tiles.instanceMatrix.needsUpdate = true;
      if (tiles.instanceColor !== null) tiles.instanceColor.needsUpdate = true;

      walls.forEach(({ cells }, i) => {
        // 壁の両側のうち、始点に近い方のマスの色で光らせる
        const nearest = cells.reduce((p, c) => (distance(c) < distance(p) ? c : p));
        const wall = shade(nearest, s) ?? colorDim;
        const k = wall === colorDim ? 0.4 : 1;
        topColors.setXYZ(i * 2, wall.r * k, wall.g * k, wall.b * k);
        topColors.setXYZ(i * 2 + 1, wall.r * k, wall.g * k, wall.b * k);
      });
      topColors.needsUpdate = true;

      const shown = Math.round(progress(beat, MEET_TO_PATH) * path.length);
      path.forEach((p, i) => pathLine.set(i, p.x, p.y, p.z));
      pathLine.commit(beat >= MEET_TO_PATH[0] ? Math.max(shown, 0) : 0);

      // 光点: 探索中は始点に、出会ったあとは最短路をたどって出会うマスへ
      const g = easeInOutCubic(progress(beat, GATHER));
      const pa = path[Math.round(g * (halfA.length - 1))] ?? corner;
      const pb = path[path.length - 1 - Math.round(g * (halfB.length - 1))] ?? cornerB;
      lightPositions.setXYZ(0, pa.x, 0.008, pa.z);
      lightPositions.setXYZ(1, pb.x, 0.008, pb.z);
      lightPositions.needsUpdate = true;
      setText(readout, beat < SEARCH[1] ? `BFS  depth = ${Math.floor(s)}` : `path = ${path.length - 1} steps`);
    },
  };
});
