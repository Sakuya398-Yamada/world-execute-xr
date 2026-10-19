import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineSegments, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { contourSegments } from '../sim/contour';
import { gradient, heavyBall, loss, lossRange } from '../sim/descent';
import { arrowHead, panelFrame } from './parts/chorus';
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
  standLabel,
  titleBlock,
} from './kit';

/**
 * #15 実行: 損失関数の曲面を、点が慣性つきの勾配降下で谷底へ転がる。床には等高線と勾配の矢印、奥のパネルには損失の推移(対数)。
 * 点が最小値に着いた瞬間(2小節目の頭)に EXECUTE が走り、曲面に波が広がり、
 * 周りに並べた 1番の各シーンのモチーフ(縮小版)へ光が飛んで、一斉に動き出す。
 * 2小節を想定。
 */

const CENTER = new Vector3(-0.012, 0, -0.008);
const SIZE = 0.17;
const BASE = 0.014;
const HEIGHT = 0.052;
/** 曲面のワイヤーフレームの分割数 */
const GRID = 28;
/** 等高線を引く格子の分割数と、本数 */
const CONTOUR_N = 64;
const LEVELS = 11;
const QUIVER = 9;
const STEPS = 160;
const DESCENT = { start: [-0.85, 0.82] as const, eta: 0.012, momentum: 0.86 };
/** 降下の区間 [拍]。始めの BIG 回で大きく動き、残りで落ち着く。終わりが「実行」の瞬間(2小節目の頭) */
const TIMING = {
  draw: [0, 1] as const,
  move: [0.25, 3.4] as const,
  settle: [3.4, 4] as const,
  big: 70,
  execute: 4,
  rays: [4, 5] as const,
} as const;
const RING = { rx: 0.168, rz: 0.118 } as const;
const PANEL = { x0: -0.19, x1: -0.072, y0: 0.036, y1: 0.092, z: -0.142 } as const;
/** 損失の対数グラフの下限 */
const LOG_FLOOR = -4;

const { min: F_MIN, max: F_MAX } = lossRange(200);

/** 正規化した座標 → ステージの位置(曲面の上) */
function surfacePoint(u: number, v: number, out: Vector3, lift = 0): Vector3 {
  return out.set(CENTER.x + (u * SIZE) / 2, BASE + (HEIGHT * (loss(u, v) - F_MIN)) / (F_MAX - F_MIN) + lift, CENTER.z + (v * SIZE) / 2);
}

/** 等高線の格子の座標 → 床の位置 */
function gridToFloor(gi: number, gj: number, out: Vector3): Vector3 {
  return out.set(CENTER.x + ((gi / CONTOUR_N) * 2 - 1) * (SIZE / 2), Y_INK, CENTER.z + ((gj / CONTOUR_N) * 2 - 1) * (SIZE / 2));
}

/** 1番の各シーンのモチーフを、手のひらサイズの線画にする(XY 面、高さ約 2.4cm)。並びは図番の順(#15 は自分なので除く) */
function motifs(): { fig: number; builder: LineBuilder }[] {
  const s = 0.011;
  const p = (x: number, y: number): Vector3 => new Vector3(x * s, s + y * s, 0);
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const curve = (f: (t: number) => [number, number], n = 24): Vector3[] => Array.from({ length: n + 1 }, (_, i) => p(...f(i / n)));
  const arrow = (b: LineBuilder, x: number, up: boolean): LineBuilder => {
    const y0 = up ? -1 : 1;
    const y1 = -y0;
    return b.segment(p(x, y0), p(x, y1)).segment(p(x - 0.22, y1 - 0.35 * y1), p(x, y1)).segment(p(x + 0.22, y1 - 0.35 * y1), p(x, y1));
  };
  return [
    { fig: 1, builder: new LineBuilder().polyline([p(-1, -1), p(1, -1), p(1, -0.5), p(-1, -0.5)], true).segment(p(0, -0.5), p(0.5, 0.7)) },
    {
      fig: 2,
      builder: new LineBuilder()
        .polyline(curve((t) => [Math.cos(Math.PI * t), Math.sin(Math.PI * t) * 1.8 - 1]))
        .polyline(curve((t) => [0.45 * Math.cos(Math.PI * t), Math.sin(Math.PI * t) * 1.8 - 1]))
        .segment(p(-1, -0.1), p(1, -0.1))
        .segment(p(-1.1, -1), p(1.1, -1)),
    },
    {
      fig: 3,
      builder: new LineBuilder()
        .polyline([p(-1, -1), p(0.4, -1), p(0.4, 0.4), p(-1, 0.4)], true)
        .polyline([p(-0.4, -0.4), p(1, -0.4), p(1, 1), p(-0.4, 1)], true)
        .segment(p(-1, -1), p(-0.4, -0.4))
        .segment(p(0.4, -1), p(1, -0.4))
        .segment(p(0.4, 0.4), p(1, 1))
        .segment(p(-1, 0.4), p(-0.4, 1)),
    },
    {
      fig: 4,
      builder: new LineBuilder()
        .polyline([p(-0.7, 1), p(-1, 1), p(-1, -1), p(-0.7, -1)])
        .polyline([p(0.7, 1), p(1, 1), p(1, -1), p(0.7, -1)])
        .segment(p(-0.6, 0.55), p(0.6, 0.55))
        .segment(p(-0.6, 0), p(0.3, 0))
        .segment(p(-0.6, -0.55), p(0.5, -0.55)),
    },
    { fig: 5, builder: arrow(arrow(arrow(new LineBuilder(), -0.7, true), 0, false), 0.7, true) },
    {
      fig: 6,
      builder: new LineBuilder()
        .segment(p(-1, -0.6), p(1, 0.6))
        .segment(p(-0.35, 0.55), p(0.35, -0.55))
        .circle(p(-0.5, -0.1), s * 0.08, X, Y, 6)
        .circle(p(0.4, 0.4), s * 0.08, X, Y, 6)
        .circle(p(0.1, -0.2), s * 0.08, X, Y, 6)
        .circle(p(-0.2, 0.25), s * 0.08, X, Y, 6)
        .circle(p(0.7, 0.2), s * 0.08, X, Y, 6),
    },
    { fig: 7, builder: new LineBuilder().circle(p(0, 0), s, X, Y, 32).segment(p(-1, 0), p(1, 0)).segment(p(0, -1), p(0, 1)).segment(p(-1.2, -1), p(1.2, -1)) },
    {
      fig: 8,
      builder: new LineBuilder()
        .polyline(curve((t) => [t * 2 - 1, 0.8 * Math.sin(t * Math.PI * 2)]))
        .segment(p(-0.75, 0.55), p(0.25, 1.05))
        .segment(p(-1, -1), p(1, -1)),
    },
    {
      fig: 9,
      builder: new LineBuilder()
        .segment(p(-1, -1), p(-1, 0.1))
        .segment(p(-0.2, -1), p(-0.2, 0.6))
        .segment(p(0.3, -1), p(0.3, 0.78))
        .segment(p(0.6, -1), p(0.6, 0.86))
        .segment(p(0.78, -1), p(0.78, 0.9))
        .segment(p(-1.1, 1), p(1.1, 1)),
    },
    {
      fig: 10,
      builder: new LineBuilder()
        .polyline([p(-0.5, 0.6), p(-0.5, -0.6), p(0.4, 0), p(-0.5, 0.6)])
        .segment(p(0.4, 0.6), p(0.4, -0.6))
        .segment(p(-1, 0), p(-0.5, 0))
        .segment(p(0.4, 0), p(1, 0)),
    },
    {
      fig: 11,
      builder: new LineBuilder()
        .polyline(curve((t) => [Math.sin(3 * t * Math.PI * 2), Math.sin(2 * t * Math.PI * 2)], 60))
        .polyline(curve((t) => [Math.sin(3 * t * Math.PI * 2 + 0.6) * 0.9, Math.sin(2 * t * Math.PI * 2) * 0.9], 60)),
    },
    {
      fig: 12,
      builder: new LineBuilder()
        .segment(p(-1.1, -0.6), p(1.1, -0.6))
        .segment(p(-0.8, -0.6), p(-0.8, -0.35))
        .segment(p(-0.3, -0.6), p(-0.3, -0.35))
        .segment(p(0.2, -0.6), p(0.2, -0.35))
        .segment(p(0.7, -0.6), p(0.7, -0.35))
        .segment(p(0, -0.6), p(0, 0.9)),
    },
    {
      fig: 13,
      builder: new LineBuilder()
        .segment(p(-1, 1), p(1, 1))
        .segment(p(-0.6, 1), p(-0.75, -0.4))
        .circle(p(-0.77, -0.6), s * 0.2, X, Y, 12)
        .segment(p(0, 1), p(-0.15, -0.4))
        .circle(p(-0.17, -0.6), s * 0.2, X, Y, 12)
        .segment(p(0.6, 1), p(0.45, -0.4))
        .circle(p(0.43, -0.6), s * 0.2, X, Y, 12),
    },
    {
      fig: 14,
      builder: (() => {
        const b = new LineBuilder();
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const x0 = -1 + i * 0.72;
            const y0 = -1 + j * 0.72;
            b.polyline([p(x0, y0), p(x0 + 0.56, y0), p(x0 + 0.56, y0 + 0.56), p(x0, y0 + 0.56)], true);
          }
        }
        return b;
      })(),
    },
    {
      fig: 16,
      builder: new LineBuilder()
        .polyline([p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), p(-1, -0.3)])
        .polyline([p(-0.5, -1), p(-0.5, 0.5), p(0.5, 0.5)])
        .polyline([p(0, -0.5), p(0.5, -0.5), p(0.5, 0)])
        .segment(p(-1, 0.5), p(-0.75, 0.5)),
    },
  ];
}

export const descent = defineScene('descent', () => {
  const fader = new Fader();
  const root = new Group();
  const tmp = new Vector3();

  // ---- 床: 等高線と勾配の矢印 ----
  const values: number[] = [];
  for (let j = 0; j <= CONTOUR_N; j++) {
    for (let i = 0; i <= CONTOUR_N; i++) values.push(loss((i / CONTOUR_N) * 2 - 1, (j / CONTOUR_N) * 2 - 1));
  }
  const contours = new LineBuilder();
  for (let k = 0; k < LEVELS; k++) {
    // 谷底の近くを細かく刻む
    const level = F_MIN + (F_MAX - F_MIN) * ((k + 0.5) / LEVELS) ** 1.7;
    const seg = contourSegments(values, CONTOUR_N, CONTOUR_N, level);
    for (let s = 0; s < seg.length; s += 4) {
      contours.segment(gridToFloor(seg[s] ?? 0, seg[s + 1] ?? 0, new Vector3()), gridToFloor(seg[s + 2] ?? 0, seg[s + 3] ?? 0, new Vector3()));
    }
  }
  const contourMaterial = fader.line(PALETTE.dim, 0.55);
  const contourLines = contours.build(contourMaterial);
  root.add(contourLines);
  const contourCount = contourLines.geometry.getAttribute('position').count;

  // 今の損失の高さの等高線(点が降りるにつれて谷底へ縮む)
  const levelArray = new Float32Array(4000 * 3);
  const levelAttribute = new BufferAttribute(levelArray, 3);
  levelAttribute.setUsage(DynamicDrawUsage);
  const levelGeometry = new BufferGeometry();
  levelGeometry.setAttribute('position', levelAttribute);
  const levelMaterial = fader.line(PALETTE.warm, 0.85);
  const levelLine = new LineSegments(levelGeometry, levelMaterial);
  levelLine.frustumCulled = false;
  root.add(levelLine);
  let drawnLevel = Number.NaN;
  const drawLevel = (level: number): void => {
    if (level === drawnLevel) return;
    drawnLevel = level;
    const seg = contourSegments(values, CONTOUR_N, CONTOUR_N, level);
    const count = Math.min(seg.length / 4, levelArray.length / 6);
    for (let s = 0; s < count; s++) {
      gridToFloor(seg[s * 4] ?? 0, seg[s * 4 + 1] ?? 0, tmp);
      levelArray.set([tmp.x, Y_INK * 2, tmp.z], s * 6);
      gridToFloor(seg[s * 4 + 2] ?? 0, seg[s * 4 + 3] ?? 0, tmp);
      levelArray.set([tmp.x, Y_INK * 2, tmp.z], s * 6 + 3);
    }
    levelAttribute.needsUpdate = true;
    levelGeometry.setDrawRange(0, count * 2);
  };

  const quiver = new LineBuilder();
  for (let i = 0; i < QUIVER; i++) {
    for (let j = 0; j < QUIVER; j++) {
      const u = ((i + 0.5) / QUIVER) * 2 - 1;
      const v = ((j + 0.5) / QUIVER) * 2 - 1;
      const [gu, gv] = gradient(u, v);
      const g = Math.hypot(gu, gv);
      if (g < 1e-3) continue;
      // 下り坂の向き(−∇f)。長さは勾配の大きさに応じて、上限つき
      const len = Math.min(0.0075, 0.004 + g * 0.004);
      const dir = new Vector3(-gu / g, 0, -gv / g);
      const from = new Vector3(CENTER.x + (u * SIZE) / 2, Y_INK, CENTER.z + (v * SIZE) / 2);
      const tip = from.clone().addScaledVector(dir, len);
      quiver.segment(from, tip);
      arrowHead(quiver, tip, dir.clone().negate(), new Vector3(-dir.z, 0, dir.x), 0.0022);
    }
  }
  const quiverMaterial = fader.line(PALETTE.cyan, 0.35);
  const quiverLines = quiver.build(quiverMaterial);
  root.add(quiverLines);
  const quiverCount = quiverLines.geometry.getAttribute('position').count;

  // ---- 曲面(高さで色を変えるワイヤーフレーム。実行のあと波が広がる) ----
  const vertices: [number, number][] = [];
  for (let i = 0; i <= GRID; i++) {
    const a = (i / GRID) * 2 - 1;
    for (let j = 0; j < GRID; j++) {
      const b0 = (j / GRID) * 2 - 1;
      const b1 = ((j + 1) / GRID) * 2 - 1;
      vertices.push([a, b0], [a, b1], [b0, a], [b1, a]);
    }
  }
  const surfaceArray = new Float32Array(vertices.length * 3);
  const surfaceColors = new Float32Array(vertices.length * 3);
  const low = new Color(PALETTE.cyan);
  const high = new Color(PALETTE.idle);
  const c = new Color();
  vertices.forEach(([u, v], k) => {
    surfacePoint(u, v, tmp);
    surfaceArray.set([tmp.x, tmp.y, tmp.z], k * 3);
    c.copy(low).lerp(high, clamp01((loss(u, v) - F_MIN) / (F_MAX - F_MIN)) ** 0.6);
    surfaceColors.set([c.r, c.g, c.b], k * 3);
  });
  const baseHeights = vertices.map((_, k) => surfaceArray[k * 3 + 1] ?? 0);
  const surfaceAttribute = new BufferAttribute(surfaceArray, 3);
  surfaceAttribute.setUsage(DynamicDrawUsage);
  const surfaceGeometry = new BufferGeometry();
  surfaceGeometry.setAttribute('position', surfaceAttribute);
  surfaceGeometry.setAttribute('color', new BufferAttribute(surfaceColors, 3));
  const surfaceMaterial = fader.line(0xffffff, 0.7);
  surfaceMaterial.vertexColors = true;
  const surface = new LineSegments(surfaceGeometry, surfaceMaterial);
  surface.frustumCulled = false;
  root.add(surface);

  // ---- 降下の軌跡 ----
  const path = heavyBall({ start: DESCENT.start, steps: STEPS, eta: DESCENT.eta, momentum: DESCENT.momentum });
  const pathPoints = path.map(([u, v]) => surfacePoint(u, v, new Vector3(), 0.003));
  const errors = path.map(([u, v]) => Math.max(loss(u, v) - F_MIN, 1e-9));
  const finishUV = path[path.length - 1] ?? [0, 0];
  const finish = surfacePoint(finishUV[0], finishUV[1], new Vector3());

  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const ballMaterial = fader.line(PALETTE.glow, 1);
  const ball = new LineBuilder()
    .circle(new Vector3(), 0.0045, X, Y, 16)
    .circle(new Vector3(), 0.0045, Y, Z, 16)
    .circle(new Vector3(), 0.0045, X, Z, 16)
    .build(ballMaterial);
  root.add(ball);
  const trail = new DynamicLine(STEPS + 2, fader.line(PALETTE.warm, 0.95));
  const shadow = new DynamicLine(STEPS + 2, fader.line(PALETTE.warm, 0.45));
  const drop = new DynamicLine(2, fader.line(PALETTE.warm, 0.35));
  root.add(trail.line, shadow.line, drop.line);
  // 点の位置での下り坂の向き(−∇f)
  const slope = new DynamicLine(5, fader.line(PALETTE.glow, 0.9));
  root.add(slope.line);

  // ---- 奥のパネル: 損失の推移(対数) ----
  const panelMaterial = fader.line(PALETTE.gridMajor, 0.55);
  root.add(panelFrame(PANEL.x0, PANEL.x1, PANEL.y0, PANEL.y1, PANEL.z, panelMaterial));
  const graticule = new LineBuilder();
  for (let e = 1; e < -LOG_FLOOR; e++) {
    const y = PANEL.y0 + ((PANEL.y1 - PANEL.y0) * e) / -LOG_FLOOR;
    graticule.segment(new Vector3(PANEL.x0, y, PANEL.z), new Vector3(PANEL.x1, y, PANEL.z));
  }
  root.add(graticule.build(fader.line(PALETTE.gridMinor, 0.18)));
  const curve = new DynamicLine(STEPS + 1, fader.line(PALETTE.warm, 1));
  curve.line.position.z = 0.0005;
  root.add(curve.line);
  const graphY = (err: number): number => PANEL.y0 + (PANEL.y1 - PANEL.y0) * clamp01((Math.log10(err) - LOG_FLOOR) / -LOG_FLOOR);
  const graphX = (k: number): number => PANEL.x0 + ((PANEL.x1 - PANEL.x0) * k) / STEPS;
  root.add(standLabel(fader, 'log10(f - f*)', PANEL.x0, PANEL.y1 + 0.004, PANEL.z, { size: 0.0052, anchorX: 'left', anchorY: 'bottom' }));
  root.add(standLabel(fader, '0', PANEL.x0 - 0.003, PANEL.y1, PANEL.z, { size: 0.0042, anchorX: 'right' }));
  root.add(standLabel(fader, '-4', PANEL.x0 - 0.003, PANEL.y0, PANEL.z, { size: 0.0042, anchorX: 'right' }));
  root.add(standLabel(fader, `k = ${STEPS}`, PANEL.x1, PANEL.y0 - 0.004, PANEL.z, { size: 0.0042, anchorX: 'right', anchorY: 'top' }));
  const readout = standLabel(fader, '', PANEL.x0, PANEL.y1 + 0.012, PANEL.z, { size: 0.0052, anchorX: 'left', anchorY: 'bottom', color: PALETTE.glow });
  root.add(readout);

  // ---- 式と表題欄 ----
  root.add(floorLabel(fader, 'v <- mu v - eta grad f(x)', -0.19, 0.108, { size: 0.0056, anchorX: 'left' }));
  root.add(floorLabel(fader, 'x <- x + v', -0.19, 0.119, { size: 0.0056, anchorX: 'left' }));
  root.add(floorLabel(fader, `mu = ${DESCENT.momentum}   eta = ${DESCENT.eta}`, -0.19, 0.13, { size: 0.0048, anchorX: 'left', color: PALETTE.label }));
  root.add(titleBlock(fader, 15, 'EXECUTION', 'GRADIENT DESCENT WITH MOMENTUM'));

  // ---- 実行: 文字、床の波紋、モチーフへ飛ぶ光 ----
  const execute = standLabel(fader, 'EXECUTE', finish.x, finish.y + 0.046, finish.z, { size: 0.017, color: PALETTE.warm }, 0);
  const argmin = standLabel(fader, 'argmin f', finish.x, finish.y + 0.022, finish.z, { size: 0.0055 }, 0);
  root.add(execute, argmin);
  const shockMaterial = fader.line(PALETTE.warm, 0);
  const shock = new LineBuilder().circle(new Vector3(), 1, X, Z, 96).build(shockMaterial);
  shock.position.set(finish.x, Y_INK * 3, finish.z);
  root.add(shock);

  const ring = motifs().map(({ fig, builder }, i, all) => {
    const angle = Math.PI / 2 + (i / all.length) * Math.PI * 2;
    const material = fader.line(PALETTE.dim, 0.45);
    const icon = new Group();
    icon.add(builder.build(material));
    const pivot = new Group();
    pivot.position.set(CENTER.x + Math.cos(angle) * RING.rx, 0, CENTER.z + Math.sin(angle) * RING.rz);
    pivot.add(icon);
    const tag = floorLabel(fader, String(fig).padStart(2, '0'), 0, 0.009, { size: 0.0042 }, 0.5);
    pivot.add(tag);
    root.add(pivot);
    return { icon, material, tag, pivot, onAt: TIMING.rays[0] + (i / all.length) * (TIMING.rays[1] - TIMING.rays[0]) };
  });
  // 最小値から各モチーフへ飛ぶ光(点灯した順に増え、まとめて消える)
  const raysBuilder = new LineBuilder();
  for (const { pivot } of ring) raysBuilder.segment(finish.clone(), pivot.position.clone().setY(0.012));
  const raysMaterial = fader.line(PALETTE.glow, 0);
  const rays = raysBuilder.build(raysMaterial);
  rays.geometry.setDrawRange(0, 0);
  root.add(rays);

  const ballPos = new Vector3();
  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.35);
      const draw = progress(beat, TIMING.draw);
      contourLines.geometry.setDrawRange(0, Math.floor((easeOutCubic(draw) * contourCount) / 2) * 2);
      quiverLines.geometry.setDrawRange(0, Math.floor((clamp01(draw * 1.3 - 0.3) * quiverCount) / 2) * 2);

      // 何回目の反復まで進んだか(始めの BIG 回をゆっくり、残りを短く)
      const k = TIMING.big * easeInOutCubic(progress(beat, TIMING.move)) + (STEPS - TIMING.big) * progress(beat, TIMING.settle);
      const k0 = Math.min(Math.floor(k), STEPS);
      const frac = k - k0;
      const a = pathPoints[k0] ?? finish;
      const b = pathPoints[Math.min(k0 + 1, STEPS)] ?? finish;
      ballPos.lerpVectors(a, b, frac);
      ball.position.copy(ballPos);
      for (let i = 0; i <= k0; i++) {
        const p = pathPoints[i] ?? finish;
        trail.set(i, p.x, p.y, p.z);
        shadow.set(i, p.x, Y_INK * 2, p.z);
      }
      trail.set(k0 + 1, ballPos.x, ballPos.y, ballPos.z);
      shadow.set(k0 + 1, ballPos.x, Y_INK * 2, ballPos.z);
      trail.commit(k0 + 2);
      shadow.commit(k0 + 2);
      drop.set(0, ballPos.x, ballPos.y, ballPos.z);
      drop.set(1, ballPos.x, Y_INK, ballPos.z);
      drop.commit(2);

      const [pu, pv] = path[k0] ?? finishUV;
      const [gu, gv] = gradient(pu, pv);
      const g = Math.hypot(gu, gv);
      const fired = beat >= TIMING.execute;
      if (g > 1e-3 && !fired) {
        const du = (-gu / g) * 0.06;
        const dv = (-gv / g) * 0.06;
        surfacePoint(pu + du, pv + dv, tmp, 0.003);
        const dir = tmp.clone().sub(a).normalize();
        const len = Math.min(0.03, 0.01 + g * 0.012);
        const tip = a.clone().addScaledVector(dir, len);
        const side = new Vector3().crossVectors(dir, Y).normalize();
        const back = dir.clone().negate();
        slope.set(0, a.x, a.y, a.z);
        slope.set(1, tip.x, tip.y, tip.z);
        const w1 = tip.clone().addScaledVector(back, 0.004).addScaledVector(side, 0.002);
        const w2 = tip.clone().addScaledVector(back, 0.004).addScaledVector(side, -0.002);
        slope.set(2, w1.x, w1.y, w1.z);
        slope.set(3, tip.x, tip.y, tip.z);
        slope.set(4, w2.x, w2.y, w2.z);
        slope.commit(5);
      } else {
        slope.commit(0);
      }

      // 今の損失の高さの等高線(1/16 桁ごとに量子化して、変わったときだけ作り直す)
      const err = errors[k0] ?? 1e-9;
      const quantized = 10 ** (Math.round(Math.log10(Math.max(err, 2e-4)) * 16) / 16);
      drawLevel(fired ? F_MIN + 1e-9 : F_MIN + quantized);
      fader.set(levelMaterial, fired ? 0 : 0.85);

      // 損失の推移
      for (let i = 0; i <= k0; i++) curve.set(i, graphX(i), graphY(errors[i] ?? 1e-9), PANEL.z);
      curve.commit(k0 + 1);
      setText(readout, `k = ${String(k0).padStart(3, '0')}   f - f* ${err < 10 ** LOG_FLOOR ? `< 1e${LOG_FLOOR}` : `= ${err.toExponential(1)}`}`);

      // 実行
      const since = beat - TIMING.execute;
      fader.set(execute, fired ? Math.max(0.75, Math.exp(-since * 1.2)) : 0);
      execute.scale.setScalar(fired ? 1 + 0.5 * Math.exp(-since * 5) + 0.05 * pulse : 1);
      fader.set(argmin, fired ? 0.8 : clamp01((beat - 3) / 0.6) * 0.8);
      shock.scale.setScalar(fired ? 0.005 + since * 0.16 : 0.005);
      fader.set(shockMaterial, fired && since < 1.2 ? 0.9 * (1 - since / 1.2) : 0);
      fader.set(ballMaterial, fired ? 0.7 + 0.3 * pulse : 1);

      // 曲面の波: 最小値から広がる
      if (fired) {
        for (let v = 0; v < vertices.length; v++) {
          const x = surfaceArray[v * 3] ?? 0;
          const z = surfaceArray[v * 3 + 2] ?? 0;
          const r = Math.hypot(x - finish.x, z - finish.z);
          const front = since * 0.11;
          const envelope = r < front ? Math.exp(-(front - r) / 0.04) * Math.exp(-since / 2.5) : 0;
          surfaceArray[v * 3 + 1] = (baseHeights[v] ?? 0) + 0.006 * envelope * Math.sin((front - r) / 0.012);
        }
        surfaceAttribute.needsUpdate = true;
      } else if (surfaceArray[1] !== baseHeights[0]) {
        vertices.forEach((_, v) => (surfaceArray[v * 3 + 1] = baseHeights[v] ?? 0));
        surfaceAttribute.needsUpdate = true;
      }
      fader.set(surfaceMaterial, 0.7 + (fired ? 0.3 * Math.exp(-since * 1.5) + 0.12 * pulse : 0));

      // モチーフ: 光が届いた順に点灯して1回転し、あとは拍ごとに跳ねる
      const reached = ring.filter(({ onAt }) => beat >= onAt).length;
      rays.geometry.setDrawRange(0, reached * 2);
      fader.set(raysMaterial, fired ? 0.9 * (1 - clamp01((beat - TIMING.rays[1]) / 1)) : 0);
      for (const { icon, material, tag, onAt } of ring) {
        const on = beat >= onAt;
        const t = beat - onAt;
        material.color.set(on ? (t < 0.6 ? PALETTE.glow : PALETTE.ink) : PALETTE.dim);
        fader.set(material, on ? 0.75 + 0.25 * pulse : 0.4);
        fader.set(tag, on ? 0.9 : 0.4);
        icon.rotation.y = on ? Math.PI * 2 * easeOutCubic(clamp01(t / 0.9)) + 0.25 * Math.sin(beat * Math.PI * 0.5) : 0;
        icon.position.y = on ? 0.006 * pulse * clamp01(t) : 0;
      }
    },
  };
});
