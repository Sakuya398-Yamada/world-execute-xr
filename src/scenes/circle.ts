import { Group, Vector3 } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { archimedesPi } from '../sim/series';
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
import { arrow, dashed, floorDimension } from './parts/verseB';

/**
 * #7 円周: 円の周の長さを、2つのやり方で測る。
 * - 左奥の床: アルキメデスの方法。内接・外接の正多角形の辺を 6 → 96 と倍にしていき、周の長さで π をはさむ(表に値)
 * - 手前: 机に立てた車輪(半径 r)が滑らずに1回転し、円周が床の定規に伸びる。縁の1点はサイクロイドを描く
 * 1小節目で円をコンパスのように描き、多角形で π を追い込む。2小節目(キーワード)で車輪が転がり、2πr に届く。
 */

const R = 0.03;
/** 車輪を立てる面の z と、転がり始めの中心の x */
const WHEEL_Z = 0.045;
const START_X = -0.15;
const END_X = START_X + 2 * Math.PI * R;
/** コンパスで円を描く区間 [拍] */
const DRAW: readonly [number, number] = [0, 1];
/** 多角形の辺を倍にする拍(6, 12, 24, 48, 96 角形) */
const DOUBLE_AT = [0.5, 1, 1.5, 2, 2.5] as const;
/** 転がる区間 [拍]。キーワードの小節 */
const ROLL: readonly [number, number] = [4, 7];
const SPOKES = 8;
const CYCLOID_SAMPLES = 200;

const ARCHI = { center: new Vector3(-0.13, Y_INK * 2, -0.075), radius: 0.048 } as const;
/** 詳細図(多角形の上端を拡大する、立てた丸い枠。手前を向く) */
const DETAIL = { center: new Vector3(-0.022, 0.068, -0.1), radius: 0.034, halfWidth: 0.026 } as const;
/** 右奥の立てたパネル: π の桁と、アルキメデスの表 */
const PI_PANEL = { x0: 0.052, x1: 0.192, y0: 0.012, y1: 0.118, z: -0.11 } as const;
const TABLE_ROW = 0.0088;
const PI_DIGITS = '3.14159265358979323846';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export const circle = defineScene('circle', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- 左奥の床: アルキメデスの多角形 ----
  const bounds = archimedesPi(DOUBLE_AT.length - 1);
  const archi = new Group();
  root.add(archi);
  const baseCircle = new LineBuilder().circle(ARCHI.center, ARCHI.radius, X, Z, 128);
  baseCircle.segment(ARCHI.center.clone().add(new Vector3(-0.002, 0, 0)), ARCHI.center.clone().add(new Vector3(0.002, 0, 0)));
  baseCircle.segment(ARCHI.center.clone().add(new Vector3(0, 0, -0.002)), ARCHI.center.clone().add(new Vector3(0, 0, 0.002)));
  archi.add(baseCircle.build(fader.line(PALETTE.glow, 0.85)));
  // 上端(奥)に辺の真ん中が来るよう、頂点を半角ずらす
  const polygon = (sides: number, radius: number): LineBuilder => {
    const points = Array.from({ length: sides }, (_, k) => {
      const a = ((k + 0.5) / sides) * Math.PI * 2 + Math.PI / 2;
      return ARCHI.center.clone().add(new Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius));
    });
    return new LineBuilder().polyline(points, true);
  };
  const polygons = bounds.map(({ sides }) => {
    const inner = fader.line(PALETTE.cyan, 0);
    const outer = fader.line(PALETTE.warm, 0);
    archi.add(polygon(sides, ARCHI.radius).build(inner));
    archi.add(polygon(sides, ARCHI.radius / Math.cos(Math.PI / sides)).build(outer));
    return { inner, outer };
  });
  // 半径(r = 1 として周 / 直径 を測る)
  archi.add(new LineBuilder().segment(ARCHI.center, ARCHI.center.clone().add(new Vector3(ARCHI.radius, 0, 0))).build(fader.line(PALETTE.ink, 0.7)));
  archi.add(floorLabel(fader, 'r = 1', ARCHI.center.x + ARCHI.radius / 2, ARCHI.center.z + 0.006, { size: 0.0044 }));
  archi.add(floorLabel(fader, 'inscribed', ARCHI.center.x - ARCHI.radius, ARCHI.center.z + ARCHI.radius + 0.012, { size: 0.0042, color: PALETTE.cyan, anchorX: 'left' }));
  archi.add(floorLabel(fader, 'circumscribed', ARCHI.center.x + 0.004, ARCHI.center.z + ARCHI.radius + 0.012, { size: 0.0042, color: PALETTE.warm, anchorX: 'left' }));

  // 多角形の上端を指す丸と、詳細図への引き出し線
  const top = ARCHI.center.clone().add(new Vector3(0, 0, -ARCHI.radius));
  const callout = new LineBuilder()
    .circle(top, 0.007, X, Z, 24)
    .segment(top.clone().add(new Vector3(0.007, 0, 0)), DETAIL.center.clone().add(new Vector3(-DETAIL.radius * Math.SQRT1_2, -DETAIL.radius * Math.SQRT1_2, 0)));
  archi.add(callout.build(fader.line(PALETTE.ink, 0.6)));

  // ---- 詳細図: 上端の1辺を、辺の数に比例して拡大する。円弧と、内接の弦・外接の接線のすき間が縮んでいく ----
  const detail = new Group();
  detail.position.copy(DETAIL.center);
  root.add(detail);
  detail.add(new LineBuilder().circle(new Vector3(), DETAIL.radius, X, Y, 96).build(fader.line(PALETTE.gridMajor, 0.6)));
  // 床まで下ろす足
  detail.add(new LineBuilder().segment(new Vector3(0, -DETAIL.radius, 0), new Vector3(0, -DETAIL.center.y, 0)).build(fader.line(PALETTE.gridMajor, 0.4)));
  const detailArc = new DynamicLine(65, fader.line(PALETTE.glow, 0.9));
  const detailChord = new DynamicLine(2, fader.line(PALETTE.cyan, 1));
  const detailTangent = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  detail.add(detailArc.line, detailChord.line, detailTangent.line);
  const detailTitle = standLabel(fader, '', -DETAIL.radius, DETAIL.radius + 0.011, 0, { size: 0.0048, anchorX: 'left', anchorY: 'bottom' });
  detail.add(detailTitle);
  const detailGap = standLabel(fader, 'gap = 1 - cos(pi/n)', -DETAIL.radius, DETAIL.radius + 0.004, 0, { size: 0.0042, anchorX: 'left', anchorY: 'bottom', color: PALETTE.label });
  detail.add(detailGap);

  // ---- 右奥: π = C / 2r の桁と、アルキメデスの表 ----
  const pr = PI_PANEL;
  root.add(panelFrame());
  root.add(standLabel(fader, 'pi = C / 2r', pr.x0 + 0.005, pr.y1 - 0.004, pr.z, { size: 0.0078, anchorX: 'left', anchorY: 'top' }));
  const digits = standLabel(fader, '', pr.x0 + 0.005, pr.y1 - 0.016, pr.z, { size: 0.0062, color: PALETTE.warm, anchorX: 'left', anchorY: 'top' });
  root.add(digits);
  const tableTop = pr.y1 - 0.034;
  root.add(standLabel(fader, '  n    lower    upper', pr.x0 + 0.005, tableTop, pr.z, { size: 0.0047, anchorX: 'left', anchorY: 'top' }));
  const rows: Text[] = bounds.map(({ sides, lower, upper }, i) => {
    const label = standLabel(
      fader,
      `${String(sides).padStart(3)}  ${lower.toFixed(5)}  ${upper.toFixed(5)}`,
      pr.x0 + 0.005,
      tableTop - (i + 1) * TABLE_ROW,
      pr.z,
      { size: 0.0047, anchorX: 'left', anchorY: 'top' },
      0,
    );
    root.add(label);
    return label;
  });
  const last = bounds[bounds.length - 1];
  const verdict = standLabel(
    fader,
    `${last?.lower.toFixed(4)} < pi < ${last?.upper.toFixed(4)}`,
    pr.x0 + 0.005,
    tableTop - (bounds.length + 1.3) * TABLE_ROW,
    pr.z,
    { size: 0.0054, color: PALETTE.warm, anchorX: 'left', anchorY: 'top' },
    0,
  );
  root.add(verdict);

  /** 右奥のパネルの枠(目盛りの無い、立てた枠と足) */
  function panelFrame(): Group {
    const group = new Group();
    const frame = new LineBuilder()
      .polyline([new Vector3(pr.x0, pr.y0, pr.z), new Vector3(pr.x1, pr.y0, pr.z), new Vector3(pr.x1, pr.y1, pr.z), new Vector3(pr.x0, pr.y1, pr.z)], true)
      .segment(new Vector3(pr.x0, 0, pr.z), new Vector3(pr.x0, pr.y0, pr.z))
      .segment(new Vector3(pr.x1, 0, pr.z), new Vector3(pr.x1, pr.y0, pr.z))
      .segment(new Vector3(pr.x0, pr.y1 - 0.026, pr.z), new Vector3(pr.x1, pr.y1 - 0.026, pr.z));
    group.add(frame.build(fader.line(PALETTE.gridMajor, 0.55)));
    return group;
  }

  // ---- 手前: 車輪(コンパスで描く円、スポーク、縁の印) ----
  const wheel = new Group();
  wheel.position.set(START_X, R, WHEEL_Z);
  root.add(wheel);
  const rimPoints = Array.from({ length: 97 }, (_, i) => {
    // 床と接する点(真下)から反時計回りに描く
    const a = -Math.PI / 2 + (i / 96) * Math.PI * 2;
    return new Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
  });
  const rim = new LineBuilder().polyline(rimPoints).build(fader.line(PALETTE.glow, 1));
  wheel.add(rim);
  const rimCount = rim.geometry.getAttribute('position').count;
  const spokes = new LineBuilder();
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    spokes.segment(new Vector3(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12, 0), new Vector3(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92, 0));
  }
  spokes.circle(new Vector3(), R * 0.12, X, Y, 16);
  const spokeMaterial = fader.line(PALETTE.ink, 0);
  wheel.add(spokes.build(spokeMaterial));
  // コンパスの腕(描いている間だけ)
  const compass = new DynamicLine(2, fader.line(PALETTE.warm, 0.9));
  wheel.add(compass.line);
  // 縁の印(最初に床と接している点)
  const mark = new LineBuilder().circle(new Vector3(0, -R, 0), 0.0028, X, Y, 16).build(fader.line(PALETTE.warm, 1));
  wheel.add(mark);
  const radiusLabel = standLabel(fader, 'r', R * 0.45, 0.004, 0.0005, { size: 0.0055, color: PALETTE.label });
  wheel.add(radiusLabel);
  wheel.add(new LineBuilder().segment(new Vector3(0, 0, 0), new Vector3(R, 0, 0)).build(fader.line(PALETTE.ink, 0.8)));

  // 中心の軌跡(破線)
  const centerPathMaterial = fader.line(PALETTE.dim, 0);
  root.add(dashed(new LineBuilder(), new Vector3(START_X, R, WHEEL_Z), new Vector3(END_X, R, WHEEL_Z), 0.003, 0.003).build(centerPathMaterial));

  // 床の定規: 伸びた円周(暖色)、r ごとの目盛り、2πr の印
  const ruler = new LineBuilder().segment(new Vector3(START_X - 0.012, Y_INK, WHEEL_Z), new Vector3(END_X + 0.03, Y_INK, WHEEL_Z));
  root.add(ruler.build(fader.line(PALETTE.ink, 0.5)));
  const unrolled = new LineBuilder()
    .segment(new Vector3(0, Y_INK * 2, WHEEL_Z), new Vector3(1, Y_INK * 2, WHEEL_Z))
    .segment(new Vector3(0, Y_INK * 2, WHEEL_Z + 0.0012), new Vector3(1, Y_INK * 2, WHEEL_Z + 0.0012))
    .build(fader.line(PALETTE.warm, 1));
  unrolled.position.x = START_X;
  root.add(unrolled);
  const ticks = Array.from({ length: 7 }, (_, k) => {
    const x = START_X + k * R;
    const material = fader.line(PALETTE.ink, 0);
    const tick = new LineBuilder().segment(new Vector3(x, Y_INK, WHEEL_Z - 0.004), new Vector3(x, Y_INK, WHEEL_Z + 0.006)).build(material);
    root.add(tick);
    const label = floorLabel(fader, k === 0 ? '0' : k === 1 ? 'r' : `${k}r`, x, WHEEL_Z + 0.012, { size: 0.0046 }, 0);
    root.add(label);
    return { material, label, x };
  });
  const endMarkMaterial = fader.line(PALETTE.warm, 0);
  root.add(
    new LineBuilder()
      .segment(new Vector3(END_X, Y_INK, WHEEL_Z - 0.008), new Vector3(END_X, Y_INK, WHEEL_Z + 0.008))
      .segment(new Vector3(END_X, 0, WHEEL_Z), new Vector3(END_X, 0.012, WHEEL_Z))
      .build(endMarkMaterial),
  );
  const dimension = floorDimension(
    fader,
    new Vector3(START_X, 0, WHEEL_Z),
    new Vector3(END_X, 0, WHEEL_Z),
    'C = 2*pi*r = 6.2832 r',
    new Vector3(0, 0, 0.032),
    PALETTE.warm,
    0.0056,
  );
  dimension.visible = false;
  root.add(dimension);

  // 縁の印の軌跡(サイクロイド)と、その長さ 8r
  const cycloid = new DynamicLine(CYCLOID_SAMPLES, fader.line(PALETTE.cyan, 0.85));
  root.add(cycloid.line);
  const archLabel = floorLabel(fader, 'cycloid  L = 8r', START_X + Math.PI * R, WHEEL_Z - 0.012, { size: 0.0048, color: PALETTE.cyan }, 0);
  root.add(archLabel);

  root.add(titleBlock(fader, 7, 'CIRCUMFERENCE', 'ROLLING WITHOUT SLIP / ARCHIMEDES 96-GON'));

  // 矢印: 転がる向き
  const directionMaterial = fader.line(PALETTE.ink, 0);
  root.add(arrow(new LineBuilder(), new Vector3(START_X + 0.045, 2 * R + 0.016, WHEEL_Z), new Vector3(START_X + 0.085, 2 * R + 0.016, WHEEL_Z), 0.005, Y).build(directionMaterial));

  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);

      // コンパスで円を描く(半径の腕が1周)
      const drawn = easeInOutCubic(progress(beat, DRAW));
      rim.geometry.setDrawRange(0, Math.max(2, Math.floor(drawn * (rimCount - 1)) + 1));
      const armAngle = -Math.PI / 2 + drawn * Math.PI * 2;
      compass.set(0, 0, 0, 0.0005);
      compass.set(1, Math.cos(armAngle) * R, Math.sin(armAngle) * R, 0.0005);
      compass.commit(drawn > 0 && drawn < 1 ? 2 : 0);
      fader.set(spokeMaterial, 0.75 * progress(beat, [1, 2]));

      // 多角形: その時点の辺の数だけを出す(前のものは薄く残す)
      const stage = DOUBLE_AT.filter((at) => beat >= at).length - 1;
      polygons.forEach(({ inner, outer }, i) => {
        const fresh = i === stage ? 1 : i === stage - 1 ? 0.25 : 0;
        const flash = i === stage ? 0.3 * Math.exp(-(beat - (DOUBLE_AT[i] ?? 0)) / 0.25) : 0;
        fader.set(inner, Math.min(1, 0.85 * fresh + flash));
        fader.set(outer, Math.min(1, 0.7 * fresh + flash));
      });
      rows.forEach((row, i) => {
        fader.set(row, i <= stage ? (i === stage ? 1 : 0.55) : 0);
        row.color = i === stage ? PALETTE.glow : PALETTE.label;
      });
      fader.set(verdict, progress(beat, [3, 3.5]));

      // 詳細図: 辺の数を倍々に(拍の間は対数で滑らかにつなぐ)。拡大率は弦の半分の幅が一定になるように決める
      const step = Math.max(0, stage) + easeInOutCubic(clamp01((beat - (DOUBLE_AT[Math.max(0, stage)] ?? 0)) / 0.3)) - 1;
      const sides = 6 * 2 ** Math.max(0, Math.min(DOUBLE_AT.length - 1, step));
      const alpha = Math.PI / sides;
      const zoom = DETAIL.halfWidth / Math.sin(alpha);
      // 詳細図の座標: u は右、v は上(多角形の外向き)。円の上端を原点に、円の中心は v = −1(半径を 1 とする)。描くものが枠の真ん中に来るようにずらす
      const middle = (Math.cos(1.3 * alpha) - 1) / 2;
      const toDetail = (u: number, v: number, i: number, line: DynamicLine): void => line.set(i, u * zoom, (v - middle) * zoom, 0.0005);
      for (let i = 0; i <= 64; i++) {
        const phi = (i / 64 - 0.5) * 2.6 * alpha;
        toDetail(Math.sin(phi), Math.cos(phi) - 1, i, detailArc);
      }
      detailArc.commit(beat >= DOUBLE_AT[0] ? 65 : 0);
      toDetail(-Math.sin(alpha), Math.cos(alpha) - 1, 0, detailChord);
      toDetail(Math.sin(alpha), Math.cos(alpha) - 1, 1, detailChord);
      detailChord.commit(beat >= DOUBLE_AT[0] ? 2 : 0);
      toDetail(-Math.tan(alpha), 0, 0, detailTangent);
      toDetail(Math.tan(alpha), 0, 1, detailTangent);
      detailTangent.commit(beat >= DOUBLE_AT[0] ? 2 : 0);
      setText(detailTitle, beat >= DOUBLE_AT[0] ? `DETAIL A  n = ${bounds[Math.max(0, stage)]?.sides ?? 6}  x${(zoom / ARCHI.radius).toFixed(1)}` : 'DETAIL A');

      // 転がる: 中心は rθ 進み、時計回り(−Z 軸まわり)に θ 回る
      const theta = 2 * Math.PI * easeInOutCubic(progress(beat, ROLL));
      wheel.position.x = START_X + R * theta;
      wheel.rotation.z = -theta;
      unrolled.scale.x = Math.max(R * theta, 1e-4);
      fader.set(centerPathMaterial, 0.5 * progress(beat, [3, 4]));
      fader.set(directionMaterial, 0.7 * progress(beat, [3, 3.5]) * (1 - progress(beat, [ROLL[0] + 0.5, ROLL[0] + 1])));
      for (const { material, label, x } of ticks) {
        const reached = START_X + R * theta >= x - 1e-6 && beat >= ROLL[0] - 1;
        const since = reached ? Math.min(1, (START_X + R * theta - x) / R) : 0;
        fader.set(material, reached ? 0.9 : 0.25 * progress(beat, [3, 4]));
        material.color.set(reached && since < 0.4 ? PALETTE.glow : PALETTE.ink);
        fader.set(label, reached ? 1 : 0);
      }
      const done = progress(beat, [ROLL[1], ROLL[1] + 0.4]);
      fader.set(endMarkMaterial, done > 0 ? 1 : 0.25 * progress(beat, [3, 4]));
      dimension.visible = beat >= ROLL[1];

      for (let i = 0; i < CYCLOID_SAMPLES; i++) {
        const s = (i / (CYCLOID_SAMPLES - 1)) * theta;
        cycloid.set(i, START_X + R * s - R * Math.sin(s), R - R * Math.cos(s) + Y_INK, WHEEL_Z);
      }
      cycloid.commit(theta > 0 ? CYCLOID_SAMPLES : 0);
      fader.set(archLabel, progress(beat, [ROLL[1] - 0.2, ROLL[1] + 0.4]));

      // π の桁: 転がる間に1桁ずつ。拍の頭で桁が光る
      const shownDigits = beat < ROLL[0] - 0.5 ? 1 : Math.min(PI_DIGITS.length, 4 + Math.floor(easeOutCubic(progress(beat, [ROLL[0], ROLL[1] + 0.5])) * (PI_DIGITS.length - 4)));
      setText(digits, PI_DIGITS.slice(0, shownDigits) + (shownDigits < PI_DIGITS.length ? '_' : '...'));
      digits.color = clamp01(pulse) > 0.6 && beat >= ROLL[0] ? PALETTE.glow : PALETTE.warm;
      fader.set(radiusLabel, 1 - progress(beat, [ROLL[0], ROLL[0] + 0.5]));
    },
  };
});
