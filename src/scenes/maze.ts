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
import { breadthFirst, carveMaze, isOpen, meetInMiddle } from '../sim/maze';
import { panelFrame } from './chorusParts';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
  clamp01,
  defineScene,
  easeInOutCubic,
  easeOutCubic,
  floorLabel,
  progress,
  setText,
  smoothstep,
  standLabel,
  titleBlock,
} from './kit';

/**
 * #16 迷路(1番の締め): 机の上の立体迷路を、両端の光点 A・B から同時に幅優先探索(BFS)で探る。
 * 探索が届いたマスと壁が、始点からの道のり(ポテンシャル)で光り、最前線ほど明るい。
 * 2つの探索が出会った瞬間(2小節目の頭)に最短路が出会った点から両側へ光り、光点がそこへ集まって1つになる。
 * 最後は、出会った点から波のように壁が床へ畳まれ、残った光が原点へ移って exit(0) を出し、1番が終わる。
 * 2小節を想定。
 */

const W = 15;
const H = 11;
const CELL = 0.0195;
const WALL_HEIGHT = 0.013;
const CENTER = new Vector3(-0.012, 0, -0.014);
const SEED = 16;

const TIMING = {
  /** 壁が床から立ち上がる */
  rise: [0, 0.75] as const,
  /** 探索の区間。終わりで2つの探索が出会う */
  search: [0.25, 4] as const,
  /** 出会った点から最短路が両側へ光る */
  path: [4, 5] as const,
  /** 光点が最短路をたどって出会った点へ集まる */
  gather: [4.75, 5.75] as const,
  /** 壁が畳まれる(出会った点から近い順に) */
  fold: [5.75, 7.25] as const,
  /** 1つになった光が原点へ移る */
  home: [6.25, 7.25] as const,
  /** exit(0) と、原点から広がる輪 */
  exit: 7.25,
} as const;

const PANEL = { x0: -0.19, x1: -0.088, y0: 0.032, y1: 0.078, z: -0.142 } as const;

/** マス c の中心(ステージ座標)。y の番号が大きいほど手前 */
function cellCenter(c: number, out: Vector3): Vector3 {
  return out.set(CENTER.x + ((c % W) - (W - 1) / 2) * CELL, Y_INK, CENTER.z + (Math.floor(c / W) - (H - 1) / 2) * CELL);
}

interface Wall {
  readonly a: Vector3;
  readonly b: Vector3;
  /** 壁の両側のマス(外周の壁は1つ) */
  readonly cells: readonly number[];
  /** 畳まれ始める拍 */
  foldAt: number;
  /** 両側のうち、始点に近い方のマス(壁はこのマスの色で光る) */
  near: number;
  /** 最後に書き込んだ高さ(変わったときだけ頂点を書き直す) */
  height: number;
}

export const maze = defineScene('maze', () => {
  const fader = new Fader();
  const root = new Group();
  const tmp = new Vector3();

  const grid = carveMaze(W, H, SEED);
  const A = (H - 1) * W; // 左手前
  const B = W - 1; // 右奥
  const fromA = breadthFirst(grid, A);
  const fromB = breadthFirst(grid, B);
  const meeting = meetInMiddle(grid, fromA, fromB);
  const meetPos = cellCenter(meeting.cell, new Vector3());
  const distA = (c: number): number => fromA.dist[c] ?? Infinity;
  const distB = (c: number): number => fromB.dist[c] ?? Infinity;
  const total = distA(B);

  // ---- 壁 ----
  const walls: Wall[] = [];
  const half = CELL / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = x + y * W;
      const p = cellCenter(c, new Vector3());
      const add = (dx0: number, dz0: number, dx1: number, dz1: number, cells: number[]): void => {
        walls.push({ a: p.clone().add(new Vector3(dx0, 0, dz0)), b: p.clone().add(new Vector3(dx1, 0, dz1)), cells, foldAt: 0, near: c, height: -1 });
      };
      if (x === W - 1) add(half, -half, half, half, [c]);
      else if (!isOpen(grid, c, c + 1)) add(half, -half, half, half, [c, c + 1]);
      if (y === H - 1) add(-half, half, half, half, [c]);
      else if (!isOpen(grid, c, c + W)) add(-half, half, half, half, [c, c + W]);
      if (x === 0) add(-half, -half, -half, half, [c]);
      if (y === 0) add(-half, -half, half, -half, [c]);
    }
  }
  // 出会った点から近い壁ほど早く畳まれる
  const farthest = Math.max(...walls.map((w) => w.a.clone().add(w.b).multiplyScalar(0.5).distanceTo(meetPos)));
  for (const wall of walls) {
    const d = wall.a.clone().add(wall.b).multiplyScalar(0.5).distanceTo(meetPos) / farthest;
    wall.foldAt = TIMING.fold[0] + d * (TIMING.fold[1] - TIMING.fold[0] - 0.45);
    wall.near = wall.cells.reduce((p, c) => (Math.min(distA(c), distB(c)) < Math.min(distA(p), distB(p)) ? c : p));
  }
  // 1枚の壁 = 下の辺、上の辺、両端の柱の4本(8頂点)
  const wallArray = new Float32Array(walls.length * 8 * 3);
  const wallColors = new Float32Array(walls.length * 8 * 3);
  const wallAttribute = new BufferAttribute(wallArray, 3);
  wallAttribute.setUsage(DynamicDrawUsage);
  const wallColorAttribute = new BufferAttribute(wallColors, 3);
  wallColorAttribute.setUsage(DynamicDrawUsage);
  const wallGeometry = new BufferGeometry();
  wallGeometry.setAttribute('position', wallAttribute);
  wallGeometry.setAttribute('color', wallColorAttribute);
  const wallMaterial = fader.line(0xffffff, 0.9);
  wallMaterial.vertexColors = true;
  const wallLines = new LineSegments(wallGeometry, wallMaterial);
  wallLines.frustumCulled = false;
  root.add(wallLines);

  // ---- 探索が届いたマス(床のタイル) ----
  const tileMaterial = fader.add(new MeshBasicMaterial({ color: 0xffffff, opacity: 0.42, depthWrite: false }));
  const tiles = new InstancedMesh(new PlaneGeometry(CELL * 0.8, CELL * 0.8).rotateX(-Math.PI / 2), tileMaterial, W * H);
  tiles.frustumCulled = false;
  root.add(tiles);

  // ---- 最短路と、光点 ----
  const pathPoints = meeting.path.map((c) => cellCenter(c, new Vector3()).setY(0.004));
  const pathLine = new DynamicLine(pathPoints.length, fader.line(PALETTE.glow, 1));
  root.add(pathLine.line);
  const lightPositions = new BufferAttribute(new Float32Array(6), 3);
  lightPositions.setUsage(DynamicDrawUsage);
  const lightGeometry = new BufferGeometry();
  lightGeometry.setAttribute('position', lightPositions);
  const lightMaterial = fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.011, depthWrite: false }));
  const lights = new Points(lightGeometry, lightMaterial);
  lights.frustumCulled = false;
  root.add(lights);
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const haloMaterial = fader.line(PALETTE.glow, 0);
  const halo = new LineBuilder().circle(new Vector3(), 1, X, Z, 64).build(haloMaterial);
  halo.position.y = Y_INK * 3;
  root.add(halo);

  // ---- 奥のパネル: 探索の最前線の大きさ(深さごとに、新しく届いたマスの数) ----
  const frontierA: number[] = [];
  const frontierB: number[] = [];
  for (let c = 0; c < W * H; c++) {
    frontierA[distA(c)] = (frontierA[distA(c)] ?? 0) + 1;
    frontierB[distB(c)] = (frontierB[distB(c)] ?? 0) + 1;
  }
  const maxFrontier = Math.max(...frontierA.filter(Number.isFinite), ...frontierB.filter(Number.isFinite), 1);
  root.add(panelFrame(PANEL.x0, PANEL.x1, PANEL.y0, PANEL.y1, PANEL.z, fader.line(PALETTE.gridMajor, 0.55)));
  const chartA = new DynamicLine(meeting.step + 2, fader.line(PALETTE.cyan, 1));
  const chartB = new DynamicLine(meeting.step + 2, fader.line(PALETTE.warm, 1));
  chartA.line.position.z = 0.0005;
  chartB.line.position.z = 0.0005;
  root.add(chartA.line, chartB.line);
  const chartX = (s: number): number => PANEL.x0 + 0.004 + ((PANEL.x1 - PANEL.x0 - 0.008) * s) / meeting.step;
  const chartY = (n: number): number => PANEL.y0 + 0.004 + ((PANEL.y1 - PANEL.y0 - 0.008) * n) / maxFrontier;
  root.add(standLabel(fader, 'frontier size / depth', PANEL.x0, PANEL.y1 + 0.004, PANEL.z, { size: 0.005, anchorX: 'left', anchorY: 'bottom' }));

  // ---- 文字 ----
  const posA = cellCenter(A, new Vector3());
  const posB = cellCenter(B, new Vector3());
  root.add(floorLabel(fader, 'A', posA.x - CELL * 0.95, posA.z, { size: 0.008, color: PALETTE.cyan }));
  root.add(floorLabel(fader, 'B', posB.x + CELL * 0.95, posB.z, { size: 0.008, color: PALETTE.warm }));
  const readout = standLabel(fader, '', PANEL.x0, PANEL.y1 + 0.012, PANEL.z, { size: 0.0056, anchorX: 'left', anchorY: 'bottom', color: PALETTE.glow });
  root.add(readout);
  root.add(floorLabel(fader, 'd(v) = d(u) + 1,  (u, v) in E', -0.19, 0.112, { size: 0.0054, anchorX: 'left' }));
  root.add(floorLabel(fader, `${W} x ${H} cells   |E| = ${W * H - 1}`, -0.19, 0.123, { size: 0.0048, anchorX: 'left', color: PALETTE.label }));
  root.add(titleBlock(fader, 16, 'MAZE', 'BIDIRECTIONAL BREADTH-FIRST SEARCH'));
  const exitLabel = standLabel(fader, 'exit(0)', 0, 0.026, 0, { size: 0.011, color: PALETTE.glow }, 0);
  root.add(exitLabel);

  const colorA = new Color(PALETTE.cyan);
  const colorB = new Color(PALETTE.warm);
  const colorIdle = new Color(PALETTE.idle);
  const colorGlow = new Color(PALETTE.glow);
  const color = new Color();
  const potential = new Color();
  const matrix = new Matrix4();
  const hidden = new Matrix4().makeScale(1e-4, 1e-4, 1e-4);

  /**
   * 探索の深さ s のときのマス c の色。届いていなければ null。
   * 出会うまでは最前線ほど明るく、出会ったあとは A → B のポテンシャル(道のりの比)で色を分ける。
   */
  const shade = (c: number, s: number, settled: number): Color | null => {
    const da = distA(c);
    const db = distB(c);
    const d = Math.min(da, db);
    if (d > s) return null;
    const front = Math.exp(-(s - d) / 2.5);
    color.copy(colorIdle).lerp(da <= db ? colorA : colorB, 0.35 + 0.65 * front);
    if (front > 0.8) color.lerp(colorGlow, (front - 0.8) * 2.5);
    if (settled > 0) {
      const phi = Number.isFinite(da) && Number.isFinite(db) ? da / (da + db) : 0.5;
      potential.copy(colorA).lerp(colorB, phi).lerp(colorIdle, 0.35);
      color.lerp(potential, settled);
    }
    return color;
  };

  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);
      const s = meeting.step * progress(beat, TIMING.search);
      const settled = smoothstep(progress(beat, [TIMING.search[1], TIMING.search[1] + 1]));
      const rise = easeOutCubic(progress(beat, TIMING.rise));

      // タイル
      const folded = beat >= TIMING.fold[1];
      for (let c = 0; c < W * H; c++) {
        const tint = shade(c, s, settled);
        if (tint === null || folded) {
          tiles.setMatrixAt(c, hidden);
        } else {
          cellCenter(c, tmp);
          matrix.makeTranslation(tmp.x, Y_INK * 1.5, tmp.z);
          tiles.setMatrixAt(c, matrix);
          tiles.setColorAt(c, tint);
        }
      }
      tiles.instanceMatrix.needsUpdate = true;
      if (tiles.instanceColor !== null) tiles.instanceColor.needsUpdate = true;
      fader.set(tileMaterial, 0.42 * (1 - smoothstep(progress(beat, [TIMING.fold[0] + 0.5, TIMING.fold[1]]))));

      // 壁: 高さ(立ち上がり / 畳まれ)と、隣のマスの色
      let moved = false;
      walls.forEach((wall, i) => {
        const fold = 1 - easeInOutCubic(clamp01((beat - wall.foldAt) / 0.45));
        const h = WALL_HEIGHT * rise * fold;
        if (h !== wall.height) {
          wall.height = h;
          moved = true;
          const { a, b } = wall;
          wallArray.set(
            [a.x, 0, a.z, b.x, 0, b.z, a.x, h, a.z, b.x, h, b.z, a.x, 0, a.z, a.x, h, a.z, b.x, 0, b.z, b.x, h, b.z],
            i * 24,
          );
        }
        const tint = shade(wall.near, s, settled);
        const top = tint === null ? colorIdle : tint;
        const k = tint === null ? 0.55 : 1;
        for (let v = 0; v < 8; v++) {
          // 下の辺は暗く、上の辺と柱の上端を明るく
          const lit = v === 2 || v === 3 || v === 5 || v === 7 ? k : k * 0.5;
          wallColors.set([top.r * lit, top.g * lit, top.b * lit], (i * 8 + v) * 3);
        }
      });
      if (moved) wallAttribute.needsUpdate = true;
      wallColorAttribute.needsUpdate = true;

      // 最短路: 出会った点から両側へ伸びる
      const reach = Math.round(progress(beat, TIMING.path) * Math.max(meeting.meetIndex, pathPoints.length - 1 - meeting.meetIndex));
      const from = Math.max(0, meeting.meetIndex - reach);
      const to = Math.min(pathPoints.length - 1, meeting.meetIndex + reach);
      let n = 0;
      for (let i = from; i <= to; i++) {
        const p = pathPoints[i] ?? meetPos;
        pathLine.set(n++, p.x, p.y, p.z);
      }
      pathLine.commit(beat >= TIMING.path[0] && beat < TIMING.fold[1] ? n : 0);

      // 光点: 探索中は始点で拍に合わせて明滅し、出会ったあとは最短路をたどって集まり、最後に原点へ
      const g = easeInOutCubic(progress(beat, TIMING.gather));
      const pa = pathPoints[Math.round(g * meeting.meetIndex)] ?? posA;
      const pb = pathPoints[pathPoints.length - 1 - Math.round(g * (pathPoints.length - 1 - meeting.meetIndex))] ?? posB;
      const home = easeInOutCubic(progress(beat, TIMING.home));
      const lift = 0.009 + 0.012 * Math.sin(Math.PI * home);
      lightPositions.setXYZ(0, pa.x * (1 - home), lift, pa.z * (1 - home));
      lightPositions.setXYZ(1, pb.x * (1 - home), lift, pb.z * (1 - home));
      lightPositions.needsUpdate = true;
      const merged = beat >= TIMING.gather[1];
      lightMaterial.size = merged ? 0.014 + 0.004 * pulse : 0.011;
      fader.set(lightMaterial, 0.75 + 0.25 * pulse);

      // 出会った瞬間と、終わりの輪
      const sinceMeet = beat - TIMING.search[1];
      const sinceExit = beat - TIMING.exit;
      if (sinceExit >= 0) {
        halo.position.set(0, Y_INK * 3, 0);
        halo.scale.setScalar(0.005 + easeOutCubic(clamp01(sinceExit / 0.9)) * 0.24);
        fader.set(haloMaterial, 0.9 * (1 - clamp01(sinceExit / 0.9)));
      } else {
        halo.position.set(meetPos.x, Y_INK * 3, meetPos.z);
        halo.scale.setScalar(0.005 + Math.max(sinceMeet, 0) * 0.09);
        fader.set(haloMaterial, sinceMeet >= 0 && sinceMeet < 0.8 ? 0.9 * (1 - sinceMeet / 0.8) : 0);
      }
      fader.set(exitLabel, sinceExit >= 0 ? clamp01(sinceExit / 0.3) : 0);
      exitLabel.scale.setScalar(1 + 0.3 * Math.exp(-Math.max(sinceExit, 0) * 5));

      // 最前線の大きさのグラフ
      const shownDepth = Math.min(meeting.step, Math.floor(s));
      for (let d = 0; d <= shownDepth; d++) {
        chartA.set(d, chartX(d), chartY(frontierA[d] ?? 0), PANEL.z);
        chartB.set(d, chartX(d), chartY(frontierB[d] ?? 0), PANEL.z);
      }
      chartA.commit(shownDepth + 1);
      chartB.commit(shownDepth + 1);

      let visited = 0;
      for (let c = 0; c < W * H; c++) if (Math.min(distA(c), distB(c)) <= s) visited += 1;
      setText(
        readout,
        beat < TIMING.search[1]
          ? `BFS  depth ${String(Math.floor(s)).padStart(2, '0')}   visited ${visited} / ${W * H}`
          : `path ${total} steps   meet at depth ${meeting.step}`,
      );
    },
  };
});
