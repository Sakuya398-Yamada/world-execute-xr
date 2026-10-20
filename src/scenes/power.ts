import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, Points, PointsMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { DynamicLine, Fader, PALETTE, Y_INK, beatPulse, clamp01, defineScene, floorLabel, progress, setText, smoothstep, standLabel, titleBlock } from './kit';
import { scopePanel } from './parts/scope';

/**
 * #1 電源を入れる: 机の上の RC 回路(電池・スイッチ・抵抗・コンデンサ)。曲の最初の1小節(4拍)。
 * 曲の頭でスイッチが倒れ(0.75拍目)、コンデンサが充電される。
 * - 配線の上の点(電荷)は、それまでに流れた電荷 q(t) = CV(1 − e^(−t/RC)) の分だけ進み、充電が進むと止まる
 * - 配線の光は電流 i(t) = (V/R) e^(−t/RC) に比例して弱まる
 * - コンデンサの極板に + と − の電荷がたまり、極板の間に電場の矢印が育つ
 * - 奥のパネルに v_C(t) と v_R(t) を、τ = RC の目盛りつきで描く
 */

/** スイッチが入る拍 */
const FLIP = 0.75;
const V = 5;
const R = 1000;
const C = 470e-6;
/** 時定数 [s] */
const TAU = R * C;
/** パネルの横軸の長さ(時定数の何倍か) */
const PLOT_TAUS = 3;
const CURVE_SAMPLES = 120;

// 回路のレイアウト(床、ステージ座標 [m])
const RAIL = { left: -0.165, right: 0.135, back: -0.035, front: 0.085 } as const;
/** 電池とコンデンサの中心の Z(左右の辺の中ほど) */
const MID_Z = 0.025;
/** 極板の間隔の半分 */
const GAP = 0.004;
const SWITCH_X = -0.09;
const RESISTOR_X = 0.02;
const LEVER_ANGLE = 0.6;

const at = (x: number, z: number, y = Y_INK): Vector3 => new Vector3(x, y, z);
const LEGEND_OFFSET = new Vector3(0.003, 0.002, 0);
const INK = new Color(PALETTE.ink);
const WARM = new Color(PALETTE.warm);

/** 折れ線の長さと、その上の距離 s の位置 */
function pathLength(path: readonly Vector3[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += (path[i] ?? new Vector3()).distanceTo(path[i - 1] ?? new Vector3());
  return sum;
}
function pointOnPath(path: readonly Vector3[], s: number, target: Vector3): Vector3 {
  let rest = s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] ?? new Vector3();
    const b = path[i] ?? new Vector3();
    const len = a.distanceTo(b);
    if (rest <= len) return target.copy(a).lerp(b, rest / len);
    rest -= len;
  }
  return target.copy(path[path.length - 1] ?? new Vector3());
}

export const power = defineScene('power', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- 配線(電池の + → スイッチ → 抵抗 → コンデンサの手前の極板、奥の極板 → 電池の −) ----
  const forward = [at(RAIL.left, MID_Z + GAP), at(RAIL.left, RAIL.front), at(RAIL.right, RAIL.front), at(RAIL.right, MID_Z + GAP)];
  const backward = [at(RAIL.right, MID_Z - GAP), at(RAIL.right, RAIL.back), at(RAIL.left, RAIL.back), at(RAIL.left, MID_Z - GAP)];
  const wireMaterial = fader.line(PALETTE.ink, 0.7);
  root.add(new LineBuilder().polyline(forward).polyline(backward).build(wireMaterial));
  // 電流に比例して光る、同じ形の線
  const glowMaterial = fader.line(PALETTE.glow, 0);
  const glow = new LineBuilder().polyline(forward).polyline(backward).build(glowMaterial);
  glow.position.y = 0.0003;
  root.add(glow);

  // 電荷の点(配線に沿って等間隔に並べ、流れた電荷の分だけずらす)
  const paths = [forward, backward];
  const lengths = paths.map(pathLength);
  const DOT_SPACING = 0.012;
  const dots = paths.map((_, k) => Math.floor((lengths[k] ?? 0) / DOT_SPACING));
  const dotCount = dots.reduce((a, b) => a + b, 0);
  const dotPositions = new BufferAttribute(new Float32Array(dotCount * 3), 3);
  dotPositions.setUsage(DynamicDrawUsage);
  const dotGeometry = new BufferGeometry();
  dotGeometry.setAttribute('position', dotPositions);
  const dotMaterial = fader.add(new PointsMaterial({ color: PALETTE.warm, size: 0.0032, depthWrite: false }));
  const dotPoints = new Points(dotGeometry, dotMaterial);
  dotPoints.frustumCulled = false;
  root.add(dotPoints);
  /** 満充電までに点が進む距離 [m] */
  const DOT_TRAVEL = 0.05;

  // ---- 電池(長い極板が +、短い極板が −) ----
  const plate = (x: number, z: number, width: number, height: number): LineBuilder =>
    new LineBuilder().polyline([at(x - width / 2, z, 0), at(x + width / 2, z, 0), at(x + width / 2, z, height), at(x - width / 2, z, height)], true);
  const battery = new Group();
  const longPlate = plate(RAIL.left, MID_Z + GAP, 0.03, 0.024);
  const shortPlate = plate(RAIL.left, MID_Z - GAP, 0.016, 0.014);
  battery.add(longPlate.build(fader.line(PALETTE.ink, 1)), shortPlate.build(fader.line(PALETTE.ink, 1)));
  root.add(battery);
  root.add(floorLabel(fader, 'V = 5 V', RAIL.left + 0.024, MID_Z, { anchorX: 'left', size: 0.0055 }));
  root.add(standLabel(fader, '+', RAIL.left + 0.019, 0.02, MID_Z + GAP, { size: 0.007, color: PALETTE.warm }));

  // ---- スイッチ(台座、端子、支点まわりに倒れるレバー) ----
  const switchGroup = new Group();
  switchGroup.position.set(SWITCH_X, 0, RAIL.front);
  const box = new LineBuilder();
  const bw = 0.022;
  const bh = 0.008;
  const bd = 0.012;
  for (const y of [0, bh]) box.polyline([at(-bw, -bd, y), at(bw, -bd, y), at(bw, bd, y), at(-bw, bd, y)], true);
  for (const [x, z] of [[-bw, -bd], [bw, -bd], [bw, bd], [-bw, bd]] as const) box.segment(at(x, z, 0), at(x, z, bh));
  switchGroup.add(box.build(fader.line(PALETTE.ink, 0.9)));
  const lever = new Group();
  lever.position.y = bh;
  const leverMaterial = fader.line(PALETTE.ink, 1);
  lever.add(
    new LineBuilder()
      .cylinder(new Vector3(0, 0, 0), new Vector3(0, 0.026, 0), 0.0024, { longitudes: 6, rings: [0.55] })
      .circle(new Vector3(0, 0.028, 0), 0.004, new Vector3(1, 0, 0), new Vector3(0, 1, 0), 16)
      .circle(new Vector3(0, 0.028, 0), 0.004, new Vector3(0, 0, 1), new Vector3(0, 1, 0), 16)
      .build(leverMaterial),
  );
  switchGroup.add(lever);
  root.add(switchGroup);
  root.add(floorLabel(fader, 'OFF', SWITCH_X - 0.02, RAIL.front + 0.02, { size: 0.0048 }, 0.8));
  root.add(floorLabel(fader, 'ON', SWITCH_X + 0.02, RAIL.front + 0.02, { size: 0.0048, color: PALETTE.warm }, 0.8));
  // 接点が閉じた瞬間の火花
  const sparkMaterial = fader.line(PALETTE.glow, 0);
  const spark = new LineBuilder();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    spark.segment(new Vector3(Math.cos(a) * 0.004, 0.012, Math.sin(a) * 0.004), new Vector3(Math.cos(a) * 0.013, 0.012 + Math.sin(k * 1.7) * 0.004, Math.sin(a) * 0.013));
  }
  const sparkLines = spark.build(sparkMaterial);
  sparkLines.position.set(SWITCH_X, 0, RAIL.front);
  root.add(sparkLines);

  // ---- 抵抗(床のジグザグ記号と、色帯つきの円柱) ----
  const zig: Vector3[] = [];
  for (let k = 0; k <= 12; k++) {
    const x = RESISTOR_X - 0.018 + (0.036 * k) / 12;
    zig.push(at(x, RAIL.front + (k === 0 || k === 12 ? 0 : k % 2 === 0 ? 0.004 : -0.004)));
  }
  root.add(new LineBuilder().polyline(zig).build(fader.line(PALETTE.ink, 0.6)));
  const resistorMaterial = fader.line(PALETTE.ink, 1);
  root.add(
    new LineBuilder()
      .cylinder(at(RESISTOR_X - 0.015, RAIL.front, 0.008), at(RESISTOR_X + 0.015, RAIL.front, 0.008), 0.0055, { longitudes: 8, rings: [0.25, 0.4, 0.55, 0.8] })
      .build(resistorMaterial),
  );
  root.add(floorLabel(fader, 'R = 1 kOhm', RESISTOR_X, RAIL.front + 0.016, { size: 0.0052 }));

  // ---- コンデンサ(2枚の極板、たまる電荷の印、極板の間の電場) ----
  const capW = 0.034;
  const capH = 0.026;
  root.add(plate(RAIL.right, MID_Z + GAP, capW, capH).build(fader.line(PALETTE.ink, 1)), plate(RAIL.right, MID_Z - GAP, capW, capH).build(fader.line(PALETTE.ink, 1)));
  const CHARGES = 6;
  const plus = new LineBuilder();
  const minus = new LineBuilder();
  for (let k = 0; k < CHARGES; k++) {
    const x = RAIL.right - capW / 2 + (capW * (k % 3 + 0.5)) / 3;
    const y = k < 3 ? capH * 0.33 : capH * 0.7;
    plus.segment(at(x - 0.0025, MID_Z + GAP + 0.0006, y), at(x + 0.0025, MID_Z + GAP + 0.0006, y)).segment(at(x, MID_Z + GAP + 0.0006, y - 0.0025), at(x, MID_Z + GAP + 0.0006, y + 0.0025));
    minus.segment(at(x - 0.0025, MID_Z - GAP - 0.0006, y), at(x + 0.0025, MID_Z - GAP - 0.0006, y));
  }
  const plusLines = plus.build(fader.line(PALETTE.warm, 1));
  const minusLines = minus.build(fader.line(PALETTE.cyan, 1));
  root.add(plusLines, minusLines);
  const fieldMaterial = fader.line(PALETTE.glow, 0);
  const fieldArrows = new LineBuilder();
  for (const x of [-0.01, 0, 0.01]) {
    const ax = RAIL.right + x;
    const y = capH * 0.5;
    fieldArrows
      .segment(at(ax, MID_Z + GAP - 0.0008, y), at(ax, MID_Z - GAP + 0.0008, y))
      .segment(at(ax, MID_Z - GAP + 0.0008, y), at(ax - 0.0015, MID_Z - GAP + 0.0025, y))
      .segment(at(ax, MID_Z - GAP + 0.0008, y), at(ax + 0.0015, MID_Z - GAP + 0.0025, y));
  }
  root.add(fieldArrows.build(fieldMaterial));
  root.add(floorLabel(fader, 'C = 470 uF', RAIL.right - 0.024, MID_Z, { anchorX: 'right', size: 0.0052 }));

  // 回路の内側に、この回路の方程式と解
  root.add(floorLabel(fader, 'RC dv_C/dt + v_C = V', -0.03, 0.012, { size: 0.0075, color: PALETTE.label }, 0.9));
  root.add(floorLabel(fader, 'q(t) = CV(1 - e^(-t/RC)),  i(t) = (V/R) e^(-t/RC)', -0.03, 0.03, { size: 0.0048 }, 0.75));

  // 電流の向き
  root.add(
    new LineBuilder()
      .segment(at(-0.045, RAIL.front - 0.008), at(-0.03, RAIL.front - 0.008))
      .segment(at(-0.03, RAIL.front - 0.008), at(-0.034, RAIL.front - 0.0105))
      .segment(at(-0.03, RAIL.front - 0.008), at(-0.034, RAIL.front - 0.0055))
      .build(fader.line(PALETTE.warm, 0.8)),
  );
  root.add(floorLabel(fader, 'i', -0.038, RAIL.front - 0.015, { size: 0.0055, color: PALETTE.warm }));

  // ---- 奥のパネル: v_C(t) と v_R(t) ----
  const panel = scopePanel(fader, {
    x0: -0.165,
    x1: 0.115,
    y0: 0.022,
    y1: 0.088,
    z: -0.105,
    cols: 6,
    rows: 5,
    title: `v_C(t), v_R(t)    tau = RC = ${TAU.toFixed(2)} s`,
  });
  root.add(panel.group);
  const tmp = new Vector3();
  const vAt = (v: number): number => (v / V) * 0.85;
  const asymptote = new LineBuilder();
  for (let u = 0; u < 1; u += 0.03) {
    asymptote.segment(panel.at(u, vAt(V), new Vector3()), panel.at(Math.min(u + 0.015, 1), vAt(V), new Vector3()));
  }
  root.add(asymptote.build(fader.line(PALETTE.glow, 0.45)));
  // τ, 2τ, 3τ の目盛りと、τ での 63.2% の点
  for (let k = 1; k <= PLOT_TAUS; k++) {
    const u = k / PLOT_TAUS;
    const p = panel.at(u, 0, new Vector3());
    root.add(standLabel(fader, k === 1 ? 'tau' : `${k}tau`, p.x, p.y - 0.003, p.z, { anchorY: 'top', size: 0.0046 }, 0.8));
  }
  const tauMarkerMaterial = fader.line(PALETTE.cyan, 0);
  const tauMarker = new LineBuilder();
  for (let v = 0; v < vAt(V * (1 - Math.exp(-1))); v += 0.06) {
    tauMarker.segment(panel.at(1 / PLOT_TAUS, v, new Vector3()), panel.at(1 / PLOT_TAUS, Math.min(v + 0.03, vAt(V * (1 - Math.exp(-1)))), new Vector3()));
  }
  root.add(tauMarker.build(tauMarkerMaterial));
  const tauPoint = panel.at(1 / PLOT_TAUS, vAt(V * (1 - Math.exp(-1))), new Vector3());
  const tauLabel = standLabel(fader, '63.2%', tauPoint.x + 0.004, tauPoint.y + 0.004, tauPoint.z, { anchorX: 'left', anchorY: 'bottom', size: 0.0048, color: PALETTE.cyan }, 0);
  root.add(tauLabel);
  const vcTrace = new DynamicLine(CURVE_SAMPLES, fader.line(PALETTE.cyan, 1));
  const vrTrace = new DynamicLine(CURVE_SAMPLES, fader.line(PALETTE.warm, 0.9));
  root.add(vcTrace.line, vrTrace.line);
  const legendVc = standLabel(fader, 'v_C', 0, 0, 0, { anchorX: 'left', size: 0.005, color: PALETTE.cyan });
  const legendVr = standLabel(fader, 'v_R', 0, 0, 0, { anchorX: 'left', size: 0.005, color: PALETTE.warm });
  root.add(legendVc, legendVr);
  // パネルの右上に v_C、その左に i
  const vcReadout = standLabel(fader, '', 0.115, 0.092, -0.105, { anchorX: 'right', anchorY: 'bottom', size: 0.0058, color: PALETTE.cyan });
  const iReadout = standLabel(fader, '', 0.04, 0.092, -0.105, { anchorX: 'right', anchorY: 'bottom', size: 0.0058, color: PALETTE.warm });
  root.add(vcReadout, iReadout);

  root.add(titleBlock(fader, 1, 'RC CHARGING', 'SWITCH ON  V = 5 V  tau = RC = 0.47 s'));

  return {
    root,
    fader,
    update(beat, sceneCtx) {
      // スイッチ: 0.75拍目でちょうど接点が閉じるよう、その少し前から倒す
      const on = smoothstep(progress(beat, [FLIP - 0.25, FLIP]));
      lever.rotation.z = LEVER_ANGLE * (1 - 2 * on);
      const closed = beat >= FLIP;
      leverMaterial.color.set(closed ? PALETTE.glow : PALETTE.ink);
      const sinceFlip = Math.max(beat - FLIP, 0);
      fader.set(sparkMaterial, closed ? Math.max(0, 1 - sinceFlip / 0.35) : 0);
      sparkLines.scale.setScalar(1 + sinceFlip * 2);

      // 回路の状態(t はスイッチが入ってからの秒)
      const t = sinceFlip * sceneCtx.beats.secondsPerBeat;
      const charge = closed ? 1 - Math.exp(-t / TAU) : 0;
      const current = closed ? Math.exp(-t / TAU) : 0;

      // 配線の光は電流に比例。点は流れた電荷の分だけ進む
      fader.set(glowMaterial, 0.95 * current);
      wireMaterial.color.set(closed ? PALETTE.glow : PALETTE.ink);
      fader.set(wireMaterial, 0.45 + 0.25 * (1 - current));
      let n = 0;
      paths.forEach((path, k) => {
        const len = lengths[k] ?? 1;
        for (let d = 0; d < (dots[k] ?? 0); d++) {
          const s = (d * DOT_SPACING + charge * DOT_TRAVEL) % len;
          pointOnPath(path, s, tmp);
          dotPositions.setXYZ(n, tmp.x, tmp.y + 0.001, tmp.z);
          n += 1;
        }
      });
      dotPositions.needsUpdate = true;
      fader.set(dotMaterial, 0.35 + 0.65 * Math.max(current, closed ? 0.3 : 0));

      // 抵抗は電流で光り、コンデンサには電荷と電場がたまる
      resistorMaterial.color.copy(INK).lerp(WARM, current);
      const shownCharges = Math.round(charge * CHARGES);
      plusLines.geometry.setDrawRange(0, shownCharges * 4);
      minusLines.geometry.setDrawRange(0, shownCharges * 2);
      fader.set(fieldMaterial, 0.9 * charge);

      // パネル: 時刻 0〜3τ を左から右へ
      const tauNow = t / TAU;
      const drawn = closed ? Math.min(CURVE_SAMPLES, Math.max(2, Math.ceil((tauNow / PLOT_TAUS) * (CURVE_SAMPLES - 1)) + 1)) : 0;
      for (let i = 0; i < drawn; i++) {
        const s = Math.min((i / (CURVE_SAMPLES - 1)) * PLOT_TAUS, tauNow);
        const u = s / PLOT_TAUS;
        panel.at(u, vAt(V * (1 - Math.exp(-s))), tmp);
        vcTrace.set(i, tmp.x, tmp.y, tmp.z);
        panel.at(u, vAt(V * Math.exp(-s)), tmp);
        vrTrace.set(i, tmp.x, tmp.y, tmp.z);
      }
      vcTrace.commit(drawn);
      vrTrace.commit(drawn);
      const head = Math.min(tauNow, PLOT_TAUS) / PLOT_TAUS;
      legendVc.position.copy(panel.at(head, vAt(V * charge), tmp)).add(LEGEND_OFFSET);
      legendVr.position.copy(panel.at(head, vAt(V * current), tmp)).add(LEGEND_OFFSET);
      legendVc.visible = closed;
      legendVr.visible = closed;
      const pastTau = clamp01((tauNow - 1) * 4);
      fader.set(tauMarkerMaterial, 0.8 * pastTau);
      fader.set(tauLabel, pastTau);
      fader.set(panel.frameMaterial, 0.6 + 0.3 * (closed ? beatPulse(sceneCtx) : 0));

      setText(vcReadout, `v_C = ${(V * charge).toFixed(2)} V`);
      setText(iReadout, `i = ${((V / R) * current * 1000).toFixed(2)} mA`);
    },
  };
});
