import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { DynamicLine, Fader, PALETTE, beatPulse, defineScene, easeInOutCubic, progress, stageFloor, standLabel } from './kit';

/**
 * #15 実行する: 損失関数の曲面を、点が勾配降下(慣性つき)で谷底へ転がる。最小値に着いた瞬間「EXECUTE」が走り、
 * 周りに並んだ、それまでのシーンのモチーフ(縮小版)が一斉に動き出す。2小節を想定。
 */

const SIZE = 0.18;
const BASE = 0.012;
const HEIGHT = 0.05;
const GRID = 24;
/** 降下の区間 [拍]。終わりが「実行」の瞬間 */
const DESCEND: readonly [number, number] = [0.5, 4.5];
const STEPS = 160;
const RING = { rx: 0.175, rz: 0.125 } as const;

/** 正規化した座標(−1〜1)での損失関数。少しうねりのある椀 */
function loss(u: number, v: number): number {
  return 0.55 * ((u - 0.18) ** 2 + (v + 0.12) ** 2) + 0.05 * Math.cos(2.5 * Math.PI * u) * Math.cos(2.5 * Math.PI * v);
}

function gradient(u: number, v: number): [number, number] {
  const h = 1e-4;
  return [(loss(u + h, v) - loss(u - h, v)) / (2 * h), (loss(u, v + h) - loss(u, v - h)) / (2 * h)];
}

/** 慣性つき勾配降下の軌跡(正規化した座標) */
function descentPath(): [number, number][] {
  let [u, v] = [-0.85, 0.82];
  let [du, dv] = [0, 0];
  const path: [number, number][] = [[u, v]];
  for (let i = 0; i < STEPS; i++) {
    const [gu, gv] = gradient(u, v);
    du = 0.86 * du - 0.012 * gu;
    dv = 0.86 * dv - 0.012 * gv;
    u += du;
    v += dv;
    path.push([u, v]);
  }
  return path;
}

/** それまでのシーンのモチーフを、手のひらサイズの線画にする(XY 面、高さ約 2.4cm) */
function icons(): LineBuilder[] {
  const s = 0.012;
  const p = (x: number, y: number): Vector3 => new Vector3(x * s, s + y * s, 0);
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const curve = (f: (t: number) => [number, number], n = 24): Vector3[] => Array.from({ length: n + 1 }, (_, i) => p(...f(i / n)));
  return [
    // 電源スイッチ
    new LineBuilder().polyline([p(-1, -1), p(1, -1), p(1, -0.5), p(-1, -0.5)], true).segment(p(0, -0.5), p(0.5, 0.6)),
    // ケージ(ドーム)
    new LineBuilder()
      .polyline(curve((t) => [Math.cos(Math.PI * t), Math.sin(Math.PI * t) * 1.6 - 1]))
      .polyline(curve((t) => [0.5 * Math.cos(Math.PI * t), Math.sin(Math.PI * t) * 1.6 - 1]))
      .segment(p(-1, -1), p(1, -1)),
    // 立方体
    new LineBuilder()
      .polyline([p(-1, -1), p(0.4, -1), p(0.4, 0.4), p(-1, 0.4)], true)
      .polyline([p(-0.4, -0.4), p(1, -0.4), p(1, 1), p(-0.4, 1)], true)
      .segment(p(-1, -1), p(-0.4, -0.4))
      .segment(p(0.4, -1), p(1, -0.4))
      .segment(p(0.4, 0.4), p(1, 1))
      .segment(p(-1, 0.4), p(-0.4, 1)),
    // スピン
    new LineBuilder()
      .segment(p(-0.7, -1), p(-0.7, 1)).segment(p(-0.95, 0.6), p(-0.7, 1)).segment(p(-0.45, 0.6), p(-0.7, 1))
      .segment(p(0, 1), p(0, -1)).segment(p(-0.25, -0.6), p(0, -1)).segment(p(0.25, -0.6), p(0, -1))
      .segment(p(0.7, -1), p(0.7, 1)).segment(p(0.45, 0.6), p(0.7, 1)).segment(p(0.95, 0.6), p(0.7, 1)),
    // 円
    new LineBuilder().circle(p(0, 0), s, X, Y, 32).segment(p(-1, 0), p(1, 0)).segment(p(0, -1), p(0, 1)),
    // 正弦波
    new LineBuilder().polyline(curve((t) => [t * 2 - 1, Math.sin(t * Math.PI * 2)])).segment(p(-1, 0), p(1, 0)),
    // 部分和の棒
    new LineBuilder()
      .segment(p(-1, -1), p(-1, 0)).segment(p(-0.4, -1), p(-0.4, 0.55)).segment(p(0.1, -1), p(0.1, 0.75))
      .segment(p(0.5, -1), p(0.5, 0.85)).segment(p(0.8, -1), p(0.8, 0.9)).segment(p(-1.1, 1), p(1.1, 1)),
    // 振り子
    new LineBuilder()
      .segment(p(-1, 1), p(1, 1))
      .segment(p(-0.6, 1), p(-0.6, -0.4)).circle(p(-0.6, -0.6), s * 0.2, X, Y, 12)
      .segment(p(0, 1), p(0, -0.4)).circle(p(0, -0.6), s * 0.2, X, Y, 12)
      .segment(p(0.6, 1), p(0.6, -0.4)).circle(p(0.6, -0.6), s * 0.2, X, Y, 12),
  ];
}

export const descent = defineScene('descent', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader, 0.5));

  // 曲面のワイヤーフレーム
  let fMin = Infinity;
  let fMax = -Infinity;
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const f = loss((i / GRID) * 2 - 1, (j / GRID) * 2 - 1);
      fMin = Math.min(fMin, f);
      fMax = Math.max(fMax, f);
    }
  }
  const at = (u: number, v: number): Vector3 =>
    new Vector3((u * SIZE) / 2, BASE + (HEIGHT * (loss(u, v) - fMin)) / (fMax - fMin), (v * SIZE) / 2);
  const surface = new LineBuilder();
  for (let i = 0; i <= GRID; i++) {
    const a = (i / GRID) * 2 - 1;
    surface.polyline(Array.from({ length: GRID + 1 }, (_, j) => at(a, (j / GRID) * 2 - 1)));
    surface.polyline(Array.from({ length: GRID + 1 }, (_, j) => at((j / GRID) * 2 - 1, a)));
  }
  const surfaceMaterial = fader.line(PALETTE.ink, 0.45);
  root.add(surface.build(surfaceMaterial));

  // 転がる点と軌跡
  const path = descentPath().map(([u, v]) => at(u, v).add(new Vector3(0, 0.004, 0)));
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const ball = new LineBuilder()
    .circle(new Vector3(), 0.004, X, Y, 16)
    .circle(new Vector3(), 0.004, Y, Z, 16)
    .circle(new Vector3(), 0.004, X, Z, 16)
    .build(fader.line(PALETTE.glow, 1));
  root.add(ball);
  const trail = new DynamicLine(path.length, fader.line(PALETTE.warm, 0.9));
  path.forEach((point, i) => trail.set(i, point.x, point.y, point.z));
  root.add(trail.line);

  const finish = path[path.length - 1] ?? new Vector3();
  const execute = standLabel(fader, 'EXECUTE', finish.x, finish.y + 0.03, finish.z, { size: 0.016, color: PALETTE.warm }, 0);
  root.add(execute);
  root.add(standLabel(fader, 'x_{k+1} = x_k - eta grad f(x_k)', -0.19, 0.012, -0.135, { anchorX: 'left', anchorY: 'bottom', size: 0.0058 }));

  // それまでのモチーフ。実行の瞬間に、順に点灯して回り出す
  const ring = icons().map((builder, i, all) => {
    const angle = (i / all.length) * Math.PI * 2 + Math.PI / 2;
    const material = fader.line(PALETTE.dim, 0.5);
    const icon = new Group();
    icon.add(builder.build(material));
    icon.position.set(Math.cos(angle) * RING.rx, 0, Math.sin(angle) * RING.rz);
    root.add(icon);
    return { icon, material, onAt: DESCEND[1] + i * 0.08 };
  });

  return {
    root,
    fader,
    update(beat, ctx) {
      const k = easeInOutCubic(progress(beat, DESCEND));
      const index = Math.min(path.length - 1, Math.floor(k * (path.length - 1)));
      ball.position.copy(path[index] ?? finish);
      trail.commit(index + 1);

      const fired = beat >= DESCEND[1];
      const sinceFire = beat - DESCEND[1];
      fader.set(execute, fired ? Math.max(0.6, Math.exp(-sinceFire * 1.5)) : 0);
      execute.scale.setScalar(fired ? 1 + 0.4 * Math.exp(-sinceFire * 4) : 1);
      fader.set(surfaceMaterial, 0.45 + (fired ? 0.5 * Math.exp(-sinceFire * 2) : 0));

      const pulse = beatPulse(ctx);
      for (const { icon, material, onAt } of ring) {
        const on = beat >= onAt;
        material.color.set(on ? PALETTE.glow : PALETTE.dim);
        fader.set(material, on ? 0.6 + 0.4 * pulse : 0.5);
        icon.rotation.y = on ? (beat - onAt) * Math.PI : 0;
        icon.position.y = on ? 0.008 * pulse : 0;
      }
    },
  };
});
