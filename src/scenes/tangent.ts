import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineSegments, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
  clamp01,
  defineScene,
  easeInOutCubic,
  floorLabel,
  progress,
  setText,
  standLabel,
  titleBlock,
} from './kit';
import { dashed, panel } from './parts/verseB';

/**
 * #8 接線: 立てた2枚のパネルに f(x) = sin x と、その導関数 f'(x) = cos x を描く。
 * - 1小節目: 接点 P が sin の上を左から右へ滑り、その接線の傾きを下のパネルに打っていくと cos がなぞられる(導関数は傾きの記録)
 * - 2小節目の頭(キーワード): sin の上の 25 か所に一斉に接線が立ち、波が流れ出す。接線は傾きに合わせて揺れ、下の cos も一緒に流れる
 * 手前の床の分度器は、P の接線の角度 θ = atan f'(x) を指す。波が流れ出すと、拍に合わせて針が振れる。
 */

const X0 = -0.17;
const X1 = 0.17;
const Z = -0.07;
/** グラフの x の範囲 [0, 3π] を、パネルの幅に写す */
const SPAN = 3 * Math.PI;
const SX = (X1 - X0 - 0.02) / SPAN;
const SY = 0.022;
const TOP = { y: 0.114, half: 0.03 } as const;
const BOTTOM = { y: 0.042, half: 0.03 } as const;
const SAMPLES = 220;
/** 接点がなぞる区間 [拍]と、中央に戻る区間 */
const TRACE: readonly [number, number] = [0.5, 3.5];
const RETURN: readonly [number, number] = [3.5, 4];
/** キーワード(接線が一斉に立ち、波が流れ出す拍) */
const HERO = 4;
/** 波の位相の進み [rad/拍](2拍で1周期) */
const OMEGA = Math.PI;
const FAMILY = 25;
const TANGENT_HALF = 0.026;
const DIAL = { center: new Vector3(-0.118, Y_INK * 2, 0.085), radius: 0.042 } as const;

const gx = (x: number): number => X0 + 0.01 + x * SX;
/** 符号つきの表示(−0.00 にならないよう、丸めて 0 になるものは + にする) */
const signed = (v: number, digits: number): string => {
  const text = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(text) !== 0 ? '-' : '+'}${text}`;
};
const topY = (y: number): number => TOP.y + y * SY;
const bottomY = (y: number): number => BOTTOM.y + y * SY;

export const tangent = defineScene('tangent', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- パネル(目盛りは π/2 ごと)と軸 ----
  root.add(panel(fader, { x0: X0, x1: X1, y0: TOP.y - TOP.half, y1: TOP.y + TOP.half, z: Z, divisions: [6, 4], legs: false }));
  root.add(panel(fader, { x0: X0, x1: X1, y0: BOTTOM.y - BOTTOM.half, y1: BOTTOM.y + BOTTOM.half, z: Z, divisions: [6, 4] }));
  const axes = new LineBuilder()
    .segment(new Vector3(X0, TOP.y, Z), new Vector3(X1, TOP.y, Z))
    .segment(new Vector3(X0, BOTTOM.y, Z), new Vector3(X1, BOTTOM.y, Z));
  for (const y of [1, -1]) {
    dashed(axes, new Vector3(X0, topY(y), Z), new Vector3(X1, topY(y), Z), 0.003, 0.004);
    dashed(axes, new Vector3(X0, bottomY(y), Z), new Vector3(X1, bottomY(y), Z), 0.003, 0.004);
  }
  root.add(axes.build(fader.line(PALETTE.gridMajor, 0.45)));
  for (const [k, text] of [[0, '0'], [1, 'pi'], [2, '2pi'], [3, '3pi']] as const) {
    root.add(standLabel(fader, text, gx(k * Math.PI), BOTTOM.y - BOTTOM.half - 0.003, Z, { size: 0.0045, anchorY: 'top' }));
  }
  root.add(standLabel(fader, 'f(x) = sin x', X0 + 0.003, TOP.y + TOP.half + 0.003, Z, { anchorX: 'left', anchorY: 'bottom', size: 0.0062 }));
  root.add(standLabel(fader, "f'(x) = cos x", X0 + 0.003, BOTTOM.y + BOTTOM.half + 0.003, Z, { anchorX: 'left', anchorY: 'bottom', size: 0.0062, color: PALETTE.cyan }));

  // ---- 曲線 ----
  const sine = new DynamicLine(SAMPLES, fader.line(PALETTE.glow, 1));
  const cosine = new DynamicLine(SAMPLES, fader.line(PALETTE.cyan, 1));
  sine.line.position.z = 0.0006;
  cosine.line.position.z = 0.0006;
  root.add(sine.line, cosine.line);

  // ---- 接点 P の接線、傾きの三角形、下のパネルへの補助線、印 ----
  const tangentLine = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  const triangle = new DynamicLine(3, fader.line(PALETTE.warm, 0.55));
  const guide = new DynamicLine(2, fader.line(PALETTE.warm, 0.35));
  root.add(tangentLine.line, triangle.line, guide.line);
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const dotMaterial = fader.line(PALETTE.warm, 1);
  const dot = new LineBuilder().circle(new Vector3(), 0.0028, X, Y, 16).build(dotMaterial);
  const dotOnCos = new LineBuilder().circle(new Vector3(), 0.0028, X, Y, 16).build(dotMaterial);
  root.add(dot, dotOnCos);
  const pLabel = standLabel(fader, 'P', 0, 0, Z, { size: 0.0055, color: PALETTE.warm, anchorY: 'bottom' });
  const readout = standLabel(fader, '', 0, 0, Z, { size: 0.005, color: PALETTE.warm, anchorX: 'left', anchorY: 'middle' });
  root.add(pLabel, readout);

  // ---- 接線の族(キーワードで一斉に立つ)。傾きの符号で色を分ける ----
  const familyPositions = new BufferAttribute(new Float32Array(FAMILY * 6), 3);
  familyPositions.setUsage(DynamicDrawUsage);
  const familyColors = new BufferAttribute(new Float32Array(FAMILY * 6), 3);
  familyColors.setUsage(DynamicDrawUsage);
  const familyGeometry = new BufferGeometry();
  familyGeometry.setAttribute('position', familyPositions);
  familyGeometry.setAttribute('color', familyColors);
  const familyMaterial = fader.line(0xffffff, 0);
  familyMaterial.vertexColors = true;
  const family = new LineSegments(familyGeometry, familyMaterial);
  family.frustumCulled = false;
  root.add(family);

  // ---- 手前の床: 分度器(θ = atan f'(x0))と式 ----
  const dial = new LineBuilder();
  const at = (deg: number, r: number): Vector3 => {
    const a = (deg * Math.PI) / 180;
    // 0° が右(+x)、正の角度が奥(−z)
    return DIAL.center.clone().add(new Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r));
  };
  for (let d = -90; d < 90; d += 2) dial.segment(at(d, DIAL.radius), at(d + 2, DIAL.radius));
  for (let d = -90; d <= 90; d += 15) dial.segment(at(d, DIAL.radius), at(d, DIAL.radius * (d % 45 === 0 ? 0.82 : 0.9)));
  dial.segment(at(90, DIAL.radius), at(-90, DIAL.radius));
  root.add(dial.build(fader.line(PALETTE.ink, 0.6)));
  // f' は ±1 なので、θ の範囲は ±45°。その範囲を薄く示す
  const range = new LineBuilder();
  for (let d = -45; d < 45; d += 3) range.segment(at(d, DIAL.radius * 0.97), at(d + 3, DIAL.radius * 0.97));
  root.add(range.build(fader.line(PALETTE.cyan, 0.5)));
  for (const d of [45, 0, -45]) {
    const p = at(d, DIAL.radius + 0.008);
    root.add(floorLabel(fader, d === 0 ? '0' : `${d > 0 ? '+' : ''}${d}`, p.x, p.z, { size: 0.0042 }));
  }
  const needle = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  root.add(needle.line);
  const angleLabel = floorLabel(fader, '', DIAL.center.x - DIAL.radius, DIAL.center.z + 0.012, { size: 0.0048, anchorX: 'left', color: PALETTE.warm });
  root.add(angleLabel);
  root.add(floorLabel(fader, "theta = atan f'(x0)", DIAL.center.x - DIAL.radius, DIAL.center.z + 0.021, { size: 0.0044, anchorX: 'left' }));

  root.add(floorLabel(fader, 'd/dx sin x = cos x', -0.035, 0.055, { size: 0.0085, anchorX: 'left' }));
  root.add(floorLabel(fader, "f'(x) = lim (f(x+h) - f(x)) / h", -0.035, 0.07, { size: 0.0048, anchorX: 'left' }));

  root.add(titleBlock(fader, 8, 'TANGENTS', "SLOPE OF SIN TRACES ITS DERIVATIVE"));

  const color = new Color();
  const warm = new Color(PALETTE.warm);
  const cyan = new Color(PALETTE.cyan);
  const white = new Color(PALETTE.glow);

  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);
      // 波は、キーワードから右へ流れ出す
      const phase = beat < HERO ? 0 : OMEGA * (beat - HERO);
      const f = (x: number): number => Math.sin(x - phase);
      const df = (x: number): number => Math.cos(x - phase);

      // 接点 P の位置: 左から右へなぞったあと、中央へ戻る
      const traced = progress(beat, TRACE);
      const xP = beat < RETURN[0] ? traced * SPAN : SPAN + (SPAN / 2 - SPAN) * easeInOutCubic(progress(beat, RETURN));

      // sin は頭の 3/4 拍で描き、cos は P がなぞったところまで(なぞり終えたら全体)
      const drawn = Math.min(1, beat / 0.75);
      const sineCount = Math.max(2, Math.round(drawn * SAMPLES));
      const cosLimit = beat < RETURN[0] ? traced * SPAN : SPAN;
      let cosCount = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const x = (i / (SAMPLES - 1)) * SPAN;
        sine.set(i, gx(x), topY(f(x)), Z);
        if (x <= cosLimit + 1e-9) {
          cosine.set(i, gx(x), bottomY(df(x)), Z);
          cosCount = i + 1;
        }
      }
      sine.commit(sineCount);
      cosine.commit(beat >= TRACE[0] ? Math.max(cosCount, 1) : 0);

      // P の接線(グラフの縦横の縮尺の違いを入れた見た目の傾き)と、傾きの三角形
      const px = gx(xP);
      const py = topY(f(xP));
      const slope = df(xP);
      const visual = (slope * SY) / SX;
      const n = Math.hypot(1, visual);
      const shown = beat >= TRACE[0] - 0.25 ? 2 : 0;
      tangentLine.set(0, px - TANGENT_HALF / n, py - (TANGENT_HALF * visual) / n, Z + 0.001);
      tangentLine.set(1, px + TANGENT_HALF / n, py + (TANGENT_HALF * visual) / n, Z + 0.001);
      tangentLine.commit(shown);
      const run = 0.5;
      triangle.set(0, px, py, Z + 0.001);
      triangle.set(1, px + run * SX, py, Z + 0.001);
      triangle.set(2, px + run * SX, py + run * slope * SY, Z + 0.001);
      triangle.commit(beat >= TRACE[0] && beat < HERO + 1 ? 3 : 0);
      const cy = bottomY(slope);
      guide.set(0, px, py, Z + 0.0008);
      guide.set(1, px, cy, Z + 0.0008);
      guide.commit(shown);
      dot.position.set(px, py, Z + 0.001);
      dotOnCos.position.set(px, cy, Z + 0.001);
      fader.set(dotMaterial, beat >= TRACE[0] - 0.25 ? 1 : 0);
      pLabel.position.set(px, py + 0.006, Z);
      readout.position.set(px + 0.006, cy, Z);
      setText(readout, signed(slope, 2));
      fader.set(pLabel, beat >= TRACE[0] ? 1 : 0);
      fader.set(readout, beat >= TRACE[0] ? 1 : 0);

      // 接線の族: キーワードの拍から左右へ順に立つ
      let count = 0;
      for (let k = 0; k < FAMILY; k++) {
        const x = ((k + 0.5) / FAMILY) * SPAN;
        const appear = HERO + (k / (FAMILY - 1)) * 0.75;
        if (beat < appear) continue;
        const grow = easeInOutCubic(clamp01((beat - appear) / 0.25));
        const y = topY(f(x));
        const s = df(x);
        const v = (s * SY) / SX;
        const h = (TANGENT_HALF * 0.85 * grow) / Math.hypot(1, v);
        familyPositions.setXYZ(count * 2, gx(x) - h, y - h * v, Z + 0.0008);
        familyPositions.setXYZ(count * 2 + 1, gx(x) + h, y + h * v, Z + 0.0008);
        color.copy(white).lerp(s >= 0 ? warm : cyan, Math.min(1, Math.abs(s) * 1.4));
        familyColors.setXYZ(count * 2, color.r, color.g, color.b);
        familyColors.setXYZ(count * 2 + 1, color.r, color.g, color.b);
        count += 1;
      }
      familyPositions.needsUpdate = true;
      familyColors.needsUpdate = true;
      familyGeometry.setDrawRange(0, count * 2);
      const hero = beat >= HERO ? Math.exp(-(beat - HERO) / 0.8) : 0;
      fader.set(familyMaterial, Math.min(1, 0.6 + 0.25 * pulse + 0.4 * hero));

      // 分度器の針: θ = atan f'(x0)
      const theta = Math.atan(slope);
      needle.set(0, DIAL.center.x, DIAL.center.y + Y_INK, DIAL.center.z);
      needle.set(1, DIAL.center.x + Math.cos(theta) * DIAL.radius * 0.95, DIAL.center.y + Y_INK, DIAL.center.z - Math.sin(theta) * DIAL.radius * 0.95);
      needle.commit(beat >= TRACE[0] - 0.25 ? 2 : 0);
      setText(angleLabel, `theta = ${signed((theta * 180) / Math.PI, 1)} deg`);
    },
  };
});
