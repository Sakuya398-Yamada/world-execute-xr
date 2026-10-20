import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { BASEL_LIMIT, baselPartialSums } from '../sim/series';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
  clamp01,
  defineScene,
  easeOutCubic,
  floorLabel,
  progress,
  setText,
  standLabel,
  titleBlock,
} from './kit';
import { dashed, panel } from './parts/verseB';

/**
 * #9 極限: 無限に足しても有限に収まる、を3つの図で見せる。
 * - 左(立てたグラフ): 部分和 S_n = 1 + 1/4 + 1/9 + … の棒。横軸は x = 1 − 1/n で縮むので、無限個の棒が有限の幅に収まり、高さは π²/6 の漸近線に近づく
 * - 右(両対数の挿入図): 残りの差 π²/6 − S_n。傾き −1 の直線に乗る(差はおよそ 1/n)
 * - 手前の床: 正方形を半分ずつ切っていく 1/2 + 1/4 + 1/8 + … = 1
 * 棒の数は指数的に増える。2小節目の頭(キーワード)で漸近線が光り、lim S_n = π²/6 が出る。
 */

const PLOT = { x0: -0.178, width: 0.21, y0: 0.012, height: 0.1, z: -0.07 } as const;
const INSET = { x0: 0.07, x1: 0.19, y0: 0.012, y1: 0.112, z: -0.07 } as const;
const MAX_TERMS = 2000;
/** 棒の数が 1 → MAX_TERMS に増える区間 [拍](指数的に増える) */
const GROW: readonly [number, number] = [0.5, 6];
/** キーワード(漸近線が光る拍) */
const HERO = 4;
/** 床の正方形の分割 */
const SQUARE = { x: -0.188, z: 0.035, size: 0.078 } as const;
const PIECES = 16;
const pieceAt = (k: number): number => 0.5 + k * 0.45;

const xOf = (n: number): number => PLOT.x0 + PLOT.width * (1 - 1 / n);
const yOf = (s: number): number => PLOT.y0 + (s / BASEL_LIMIT) * PLOT.height;
/** 挿入図の座標: log10 n は 0〜3.5、log10(差) は −3.5〜0 */
const insetX = (logN: number): number => INSET.x0 + 0.008 + (logN / 3.5) * (INSET.x1 - INSET.x0 - 0.014);
const insetY = (logGap: number): number => INSET.y0 + 0.006 + ((logGap + 3.5) / 3.5) * (INSET.y1 - INSET.y0 - 0.012);

/** 正方形を、交互に縦横で半分に切っていく(らせん)。k 番目の長方形 [x0, z0, x1, z1](単位正方形の中) */
function halving(count: number): [number, number, number, number][] {
  const rects: [number, number, number, number][] = [];
  let [x0, z0, x1, z1] = [0, 0, 1, 1];
  for (let k = 0; k < count; k++) {
    // 右 → 下 → 左 → 上 の順に、残りの半分を切り取る
    switch (k % 4) {
      case 0: {
        const m = (x0 + x1) / 2;
        rects.push([x0, z0, m, z1]);
        x0 = m;
        break;
      }
      case 1: {
        const m = (z0 + z1) / 2;
        rects.push([x0, z0, x1, m]);
        z0 = m;
        break;
      }
      case 2: {
        const m = (x0 + x1) / 2;
        rects.push([m, z0, x1, z1]);
        x1 = m;
        break;
      }
      default: {
        const m = (z0 + z1) / 2;
        rects.push([x0, m, x1, z1]);
        z1 = m;
        break;
      }
    }
  }
  return rects;
}

export const limit = defineScene('limit', () => {
  const fader = new Fader();
  const root = new Group();
  const sums = baselPartialSums(MAX_TERMS);

  // ---- 左: 部分和の棒(縦線)。あらかじめ全部作り、描く本数を増やす。新しい棒ほど明るい ----
  root.add(panel(fader, { x0: PLOT.x0 - 0.008, x1: PLOT.x0 + PLOT.width + 0.012, y0: PLOT.y0, y1: PLOT.y0 + PLOT.height + 0.016, z: PLOT.z, divisions: [0, 0], legs: false }, 0.8));
  const barPositions = new Float32Array(MAX_TERMS * 6);
  sums.forEach((s, i) => barPositions.set([xOf(i + 1), PLOT.y0, PLOT.z + 0.0006, xOf(i + 1), yOf(s), PLOT.z + 0.0006], i * 6));
  const barGeometry = new BufferGeometry();
  barGeometry.setAttribute('position', new BufferAttribute(barPositions, 3));
  const barColors = new BufferAttribute(new Float32Array(MAX_TERMS * 6), 3);
  barColors.setUsage(DynamicDrawUsage);
  barGeometry.setAttribute('color', barColors);
  barGeometry.setDrawRange(0, 0);
  const barMaterial = fader.line(0xffffff, 0.9);
  barMaterial.vertexColors = true;
  const bars = new LineSegments(barGeometry, barMaterial);
  bars.frustumCulled = false;
  root.add(bars);

  // 横軸の目盛り(n = 1, 2, 3, 4, 5, 10, ∞)と、∞ の縦の破線
  const axis = new LineBuilder().segment(new Vector3(PLOT.x0 - 0.008, PLOT.y0, PLOT.z), new Vector3(PLOT.x0 + PLOT.width + 0.012, PLOT.y0, PLOT.z));
  // 100 以降は inf とほとんど同じ位置になるので、目盛りの文字は 10 と inf まで
  const ticks: readonly [number, string][] = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [10, '10'], [Infinity, 'inf']];
  for (const [n, text] of ticks) {
    const x = n === Infinity ? PLOT.x0 + PLOT.width : xOf(n);
    axis.segment(new Vector3(x, PLOT.y0 - 0.003, PLOT.z), new Vector3(x, PLOT.y0, PLOT.z));
    root.add(standLabel(fader, text, x, PLOT.y0 - 0.004, PLOT.z, { size: 0.0044, anchorY: 'top', color: n === Infinity ? PALETTE.warm : PALETTE.label }));
  }
  dashed(axis, new Vector3(PLOT.x0 + PLOT.width, PLOT.y0, PLOT.z), new Vector3(PLOT.x0 + PLOT.width, PLOT.y0 + PLOT.height, PLOT.z), 0.003, 0.003);
  root.add(axis.build(fader.line(PALETTE.ink, 0.75)));
  root.add(standLabel(fader, 'x = 1 - 1/n', PLOT.x0 + PLOT.width / 2, PLOT.y0 - 0.012, PLOT.z, { size: 0.0042, anchorY: 'top' }));

  // 漸近線 π²/6
  const asymptoteMaterial = fader.line(PALETTE.warm, 0.7);
  root.add(dashed(new LineBuilder(), new Vector3(PLOT.x0 - 0.008, yOf(BASEL_LIMIT), PLOT.z), new Vector3(PLOT.x0 + PLOT.width + 0.012, yOf(BASEL_LIMIT), PLOT.z), 0.005, 0.003).build(asymptoteMaterial));
  root.add(standLabel(fader, 'pi^2/6', PLOT.x0 + PLOT.width + 0.014, yOf(BASEL_LIMIT), PLOT.z, { size: 0.005, anchorX: 'left', color: PALETTE.warm }));
  root.add(standLabel(fader, 'S_n = 1 + 1/4 + 1/9 + ... + 1/n^2', PLOT.x0, PLOT.y0 + PLOT.height + 0.03, PLOT.z, { anchorX: 'left', anchorY: 'bottom', size: 0.0062 }));
  const readout = standLabel(fader, '', PLOT.x0, PLOT.y0 + PLOT.height + 0.021, PLOT.z, { anchorX: 'left', anchorY: 'bottom', size: 0.005, color: PALETTE.glow });
  root.add(readout);
  // 最新の棒の印
  const newest = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  root.add(newest.line);
  // キーワード: 極限の式
  const limitLabel = standLabel(fader, 'lim S_n = pi^2/6 = 1.6449...', PLOT.x0 + PLOT.width / 2, yOf(BASEL_LIMIT) + 0.007, PLOT.z + 0.002, { size: 0.0072, color: PALETTE.warm, anchorY: 'bottom' }, 0);
  root.add(limitLabel);

  // ---- 右: 両対数の挿入図(残りの差 π²/6 − S_n と、傾き −1 の参照線) ----
  root.add(panel(fader, { x0: INSET.x0, x1: INSET.x1, y0: INSET.y0, y1: INSET.y1, z: INSET.z, divisions: [0, 0] }));
  const insetGrid = new LineBuilder();
  for (let d = 0; d <= 3; d++) {
    insetGrid.segment(new Vector3(insetX(d), INSET.y0, INSET.z), new Vector3(insetX(d), INSET.y1, INSET.z));
    insetGrid.segment(new Vector3(INSET.x0, insetY(-d), INSET.z), new Vector3(INSET.x1, insetY(-d), INSET.z));
  }
  root.add(insetGrid.build(fader.line(PALETTE.gridMinor, 0.2)));
  for (let d = 0; d <= 3; d++) {
    root.add(standLabel(fader, `1e${d}`, insetX(d), INSET.y0 - 0.003, INSET.z, { size: 0.0038, anchorY: 'top' }));
    root.add(standLabel(fader, `1e-${d}`, INSET.x0 - 0.002, insetY(-d), INSET.z, { size: 0.0038, anchorX: 'right' }));
  }
  root.add(standLabel(fader, 'pi^2/6 - S_n', INSET.x0 + 0.004, INSET.y1 + 0.003, INSET.z, { size: 0.0046, anchorX: 'left', anchorY: 'bottom' }));
  root.add(standLabel(fader, 'n', INSET.x1, INSET.y0 - 0.003, INSET.z, { size: 0.0042, anchorX: 'right', anchorY: 'top' }));
  // 参照線 1/n(傾き −1)
  const reference = dashed(new LineBuilder(), new Vector3(insetX(0), insetY(0), INSET.z + 0.0004), new Vector3(insetX(3.4), insetY(-3.4), INSET.z + 0.0004), 0.003, 0.003);
  const referenceMaterial = fader.line(PALETTE.dim, 0);
  root.add(reference.build(referenceMaterial));
  const slopeLabel = standLabel(fader, 'slope -1  (~ 1/n)', insetX(1.9), insetY(-1.5), INSET.z, { size: 0.0042, color: PALETTE.label, anchorX: 'left' }, 0);
  root.add(slopeLabel);
  const GAP_SAMPLES = 140;
  const gapCurve = new DynamicLine(GAP_SAMPLES, fader.line(PALETTE.cyan, 1));
  gapCurve.line.position.z = 0.0006;
  root.add(gapCurve.line);

  // ---- 手前の床: 1/2 + 1/4 + 1/8 + … = 1 ----
  const unit = (u: number, v: number): Vector3 => new Vector3(SQUARE.x + u * SQUARE.size, Y_INK * 2, SQUARE.z + v * SQUARE.size);
  root.add(new LineBuilder().polyline([unit(0, 0), unit(1, 0), unit(1, 1), unit(0, 1)], true).build(fader.line(PALETTE.ink, 0.7)));
  const pieces = halving(PIECES).map(([u0, v0, u1, v1], k) => {
    const material = fader.line(k % 2 === 0 ? PALETTE.warm : PALETTE.cyan, 0);
    root.add(new LineBuilder().polyline([unit(u0, v0), unit(u1, v0), unit(u1, v1), unit(u0, v1)], true).build(material));
    const fill = fader.add(new MeshBasicMaterial({ color: k % 2 === 0 ? PALETTE.warm : PALETTE.cyan, opacity: 0, depthWrite: false }));
    const plane = new Mesh(new PlaneGeometry((u1 - u0) * SQUARE.size, (v1 - v0) * SQUARE.size), fill);
    plane.rotation.x = -Math.PI / 2;
    plane.position.copy(unit((u0 + u1) / 2, (v0 + v1) / 2)).setY(Y_INK);
    root.add(plane);
    let label: Text | null = null;
    if (k < 4) {
      const c = unit((u0 + u1) / 2, (v0 + v1) / 2);
      label = floorLabel(fader, `1/${2 ** (k + 1)}`, c.x, c.z, { size: k < 2 ? 0.0062 : 0.0046 }, 0);
      root.add(label);
    }
    return { material, fill, label };
  });
  const sumLabel = floorLabel(fader, '', SQUARE.x, SQUARE.z + SQUARE.size + 0.009, { size: 0.0052, anchorX: 'left', color: PALETTE.glow });
  root.add(sumLabel);
  root.add(floorLabel(fader, '1/2 + 1/4 + 1/8 + ... = 1', SQUARE.x, SQUARE.z - 0.007, { size: 0.005, anchorX: 'left' }));

  root.add(titleBlock(fader, 9, 'LIMITS', 'BASEL SERIES / INFINITE SUM, FINITE VALUE'));

  const color = new Color();
  const ink = new Color(PALETTE.ink);
  const glow = new Color(PALETTE.glow);
  const warm = new Color(PALETTE.warm);

  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);
      const grow = progress(beat, GROW);
      const n = beat < GROW[0] ? 0 : Math.max(1, Math.floor(Math.exp(Math.log(MAX_TERMS) * grow)));

      // 棒: 新しいほど明るく(最新の数本は暖色)
      for (let i = 0; i < n; i++) {
        const age = (n - 1 - i) / Math.max(1, n);
        color.copy(ink).lerp(glow, 1 - Math.min(1, age * 3));
        if (i >= n - 2) color.copy(warm);
        barColors.setXYZ(i * 2, color.r * 0.6, color.g * 0.6, color.b * 0.6);
        barColors.setXYZ(i * 2 + 1, color.r, color.g, color.b);
      }
      barColors.needsUpdate = true;
      barGeometry.setDrawRange(0, n * 2);
      const s = n > 0 ? (sums[n - 1] ?? BASEL_LIMIT) : 0;
      newest.set(0, xOf(Math.max(n, 1)) - 0.004, yOf(s), PLOT.z + 0.001);
      newest.set(1, xOf(Math.max(n, 1)) + 0.004, yOf(s), PLOT.z + 0.001);
      newest.commit(n > 0 ? 2 : 0);
      setText(readout, n > 0 ? `n = ${n}   S_n = ${s.toFixed(5)}   gap = ${(BASEL_LIMIT - s).toExponential(2)}` : '');

      // キーワード: 漸近線が光り、極限の式が出る
      const hero = beat >= HERO ? Math.exp(-(beat - HERO) / 0.7) : 0;
      fader.set(asymptoteMaterial, Math.min(1, 0.6 + 0.4 * hero + (beat >= HERO ? 0.2 * pulse : 0)));
      fader.set(limitLabel, easeOutCubic(progress(beat, [HERO, HERO + 0.4])));
      limitLabel.scale.setScalar(1 + 0.25 * hero);

      // 挿入図: n までの差を、対数で等間隔に取った点で描く
      const logMax = n > 0 ? Math.log10(n) : 0;
      for (let i = 0; i < GAP_SAMPLES; i++) {
        const m = Math.max(1, Math.round(10 ** ((i / (GAP_SAMPLES - 1)) * logMax)));
        const gap = BASEL_LIMIT - (sums[m - 1] ?? BASEL_LIMIT);
        gapCurve.set(i, insetX(Math.log10(m)), insetY(Math.log10(Math.max(gap, 1e-6))), INSET.z);
      }
      gapCurve.commit(n > 1 ? GAP_SAMPLES : 0);
      fader.set(referenceMaterial, 0.8 * progress(beat, [HERO - 0.5, HERO + 0.5]));
      fader.set(slopeLabel, progress(beat, [HERO, HERO + 0.5]));

      // 床: 半分ずつの長方形。最新のものは塗りが光る
      let total = 0;
      pieces.forEach(({ material, fill, label }, k) => {
        const since = beat - pieceAt(k);
        const on = since >= 0;
        if (on) total += 1 / 2 ** (k + 1);
        fader.set(material, on ? 0.85 : 0);
        fader.set(fill, on ? 0.08 + 0.3 * Math.exp(-since / 0.5) : 0);
        if (label !== null) fader.set(label, on ? clamp01(since / 0.3) : 0);
      });
      setText(sumLabel, total > 0 ? `sum = ${total.toFixed(6)}` : '');
    },
  };
});
