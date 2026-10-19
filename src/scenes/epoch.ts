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
  Vector3,
} from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { eraLabel, int64Bits, unixSecondsOfYear } from '../sim/calendar';
import {
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
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
 * #12 紀元後から紀元前へ: 机を横切る時間軸が流れ、2026 年から紀元前へさかのぼる。
 * - 手前の床には、Unix 時間(秒)を符号付き 64 ビット整数の2の補数で並べる。1970 年をまたぐと符号ビットを含む上位のビットが一斉に 1 に反転する
 * - 紀元後1年の次は紀元前1年(0 年は無い)。その境目をまたぐ瞬間を見せ場にする
 * 年は天文学的な年(0 = 紀元前1年)で計算し、暦は先発グレゴリオ暦(Unix 時間の定義と同じ)。2小節(8拍)を想定。
 */

/**
 * 時間の流れ方(拍 → 天文学的な年)。区間ごとに動き出して止まるので、原点の手前で時間がほぼ止まって読める。
 * - 2拍目でちょうど 1970 年(Unix 時間 = 0)
 * - 2小節目の頭から紀元1年の中をゆっくり進み、2小節目の2拍目で紀元前1年に入る(0 年は無い)
 * - 最後は一気に紀元前 3001 年まで
 */
const SEGMENTS: readonly { readonly beats: readonly [number, number]; readonly years: readonly [number, number]; readonly ease: (x: number) => number }[] = [
  { beats: [0.25, 2], years: [2026, 1970], ease: easeInOutCubic },
  { beats: [2, 4.5], years: [1970, 2], ease: easeInOutCubic },
  { beats: [4.5, 6], years: [2, 0], ease: (x) => x },
  { beats: [6, 7.75], years: [0, -3000], ease: (x) => x * x * x },
];
/** Unix 時間の原点と、紀元前後の境目をまたぐ拍 */
const CROSS_UNIX = 2;
const CROSS_ERA = 5.25;

const AXIS = { z: -0.005, halfWidth: 0.185 } as const;
/** 時間軸の片側に見せる年数 */
const SPAN = 2500;
const MAJOR_STEP = 500;
const MINOR_STEP = 100;
const MAX_MAJOR = Math.ceil((2 * SPAN) / MAJOR_STEP) + 2;
const MAX_MINOR = Math.ceil((2 * SPAN) / MINOR_STEP) + 2;

const BITS = { x0: -0.155, cell: 0.0097, rows: [0.05, 0.066] as const, size: 0.0078 } as const;

/** 年 → 時間軸の上の X */
const xOf = (year: number, now: number): number => ((year - now) / SPAN) * AXIS.halfWidth;

/** 拍 → いまの年(小数) */
function yearAt(beat: number): number {
  for (const { beats, years, ease } of SEGMENTS) {
    if (beat < beats[1]) return years[0] + (years[1] - years[0]) * ease(progress(beat, beats));
  }
  return SEGMENTS[SEGMENTS.length - 1]?.years[1] ?? 0;
}

export const epoch = defineScene('epoch', () => {
  const fader = new Fader();
  const root = new Group();
  const y = Y_INK * 2;

  // ---- 時間軸(定規) ----
  const axis = new LineBuilder()
    .segment(new Vector3(-AXIS.halfWidth, y, AXIS.z), new Vector3(AXIS.halfWidth, y, AXIS.z))
    // 過去の向きの矢印
    .segment(new Vector3(-AXIS.halfWidth, y, AXIS.z), new Vector3(-AXIS.halfWidth + 0.008, y, AXIS.z - 0.004))
    .segment(new Vector3(-AXIS.halfWidth, y, AXIS.z), new Vector3(-AXIS.halfWidth + 0.008, y, AXIS.z + 0.004));
  root.add(axis.build(fader.line(PALETTE.ink, 0.85)));
  root.add(floorLabel(fader, 'past', -AXIS.halfWidth + 0.004, AXIS.z - 0.012, { anchorX: 'left', size: 0.005 }, 0.7));
  root.add(floorLabel(fader, 'future', AXIS.halfWidth, AXIS.z - 0.012, { anchorX: 'right', size: 0.005 }, 0.7));

  // 流れる目盛り(毎フレーム位置を書き換える)
  const majorArray = new Float32Array(MAX_MAJOR * 6);
  const minorArray = new Float32Array(MAX_MINOR * 6);
  const majorAttribute = new BufferAttribute(majorArray, 3);
  const minorAttribute = new BufferAttribute(minorArray, 3);
  majorAttribute.setUsage(DynamicDrawUsage);
  minorAttribute.setUsage(DynamicDrawUsage);
  const majorGeometry = new BufferGeometry();
  const minorGeometry = new BufferGeometry();
  majorGeometry.setAttribute('position', majorAttribute);
  minorGeometry.setAttribute('position', minorAttribute);
  const majorTicks = new LineSegments(majorGeometry, fader.line(PALETTE.ink, 0.8));
  const minorTicks = new LineSegments(minorGeometry, fader.line(PALETTE.gridMajor, 0.35));
  majorTicks.frustumCulled = false;
  minorTicks.frustumCulled = false;
  root.add(majorTicks, minorTicks);
  const tickLabels: Text[] = Array.from({ length: MAX_MAJOR }, () => {
    const label = floorLabel(fader, '', 0, AXIS.z + 0.016, { size: 0.0046 }, 0.75);
    root.add(label);
    return label;
  });

  // 時間軸の上の印: Unix 時間の原点、紀元前後の境目、グレゴリオ暦の始まり
  const markers = [
    { year: 1970, text: 'unix 0', color: PALETTE.cyan, height: 0.03 },
    { year: 1582, text: 'gregorian', color: PALETTE.dim, height: 0.018 },
    { year: 0.5, text: 'AD | BC', color: PALETTE.warm, height: 0.03 },
  ].map(({ year, text, color, height }) => {
    const group = new Group();
    group.add(new LineBuilder().segment(new Vector3(0, 0, 0), new Vector3(0, height, 0)).build(fader.line(color, 0.9)));
    group.add(standLabel(fader, text, 0, height + 0.004, 0, { size: 0.0048, color, anchorY: 'bottom' }));
    root.add(group);
    return { year, group };
  });

  // ---- 「いま」の針と、年と Unix 時間のカウンタ ----
  const needleMaterial = fader.line(PALETTE.warm, 1);
  const needle = new LineBuilder()
    .segment(new Vector3(0, 0, AXIS.z), new Vector3(0, 0.052, AXIS.z))
    .segment(new Vector3(-0.004, 0.006, AXIS.z), new Vector3(0, 0, AXIS.z))
    .segment(new Vector3(0.004, 0.006, AXIS.z), new Vector3(0, 0, AXIS.z));
  root.add(needle.build(needleMaterial));
  const yearLabel = standLabel(fader, '', 0, 0.078, AXIS.z, { size: 0.017, color: PALETTE.glow, anchorY: 'bottom' });
  const unixLabel = standLabel(fader, '', 0, 0.062, AXIS.z, { size: 0.0062, anchorY: 'bottom' });
  const note = standLabel(fader, 'AD 1 -> BC 1  (there is no year 0)', 0, 0.1, AXIS.z, { size: 0.0055, color: PALETTE.warm, anchorY: 'bottom' }, 0);
  root.add(yearLabel, unixLabel, note);

  // ---- 64 ビットのレジスタ(床) ----
  const cellOutline = new LineBuilder();
  const cellCenter = (i: number): Vector3 => {
    const row = Math.floor(i / 32);
    const col = i % 32;
    return new Vector3(BITS.x0 + (col + 0.5) * BITS.cell, y, BITS.rows[row] ?? 0);
  };
  for (let i = 0; i < 64; i++) {
    const c = cellCenter(i);
    const h = BITS.size / 2;
    cellOutline.polyline(
      [new Vector3(c.x - h, y, c.z - h), new Vector3(c.x + h, y, c.z - h), new Vector3(c.x + h, y, c.z + h), new Vector3(c.x - h, y, c.z + h)],
      true,
    );
  }
  root.add(cellOutline.build(fader.line(PALETTE.gridMajor, 0.45)));
  const cells = new InstancedMesh(
    new PlaneGeometry(BITS.size * 0.78, BITS.size * 0.78).rotateX(-Math.PI / 2),
    fader.add(new MeshBasicMaterial({ color: 0xffffff, opacity: 0.85, depthWrite: false })),
    64,
  );
  cells.frustumCulled = false;
  root.add(cells);
  root.add(floorLabel(fader, 'sign', cellCenter(0).x, BITS.rows[0] - 0.011, { size: 0.0045, color: PALETTE.warm }));
  root.add(floorLabel(fader, 'bit 63', cellCenter(0).x - 0.008, BITS.rows[0], { size: 0.0042, anchorX: 'right' }, 0.7));
  root.add(floorLabel(fader, 'bit 0', cellCenter(63).x + 0.008, BITS.rows[1], { size: 0.0042, anchorX: 'left' }, 0.7));
  const bitsCaption = floorLabel(fader, '', BITS.x0, BITS.rows[1] + 0.014, { size: 0.005, anchorX: 'left' });
  root.add(bitsCaption);

  root.add(titleBlock(fader, 12, 'A.D. -> B.C.', 'UNIX TIME AS INT64, PROLEPTIC GREGORIAN'));

  const matrix = new Matrix4();
  const hidden = new Matrix4().makeScale(1e-4, 1e-4, 1e-4);
  const signColor = new Color(PALETTE.warm);
  const bitColor = new Color(PALETTE.cyan);
  const flashColor = new Color(PALETTE.glow);
  const color = new Color();

  return {
    root,
    fader,
    update(beat, ctx) {
      const appear = easeOutCubic(progress(beat, [0, 0.75]));
      const now = yearAt(beat);
      const year = Math.floor(now);
      setText(yearLabel, eraLabel(year));
      const unix = Math.round(unixSecondsOfYear(now));
      setText(unixLabel, `unix t = ${unix} s`);

      // 目盛り
      let majors = 0;
      for (let yr = Math.ceil((now - SPAN) / MAJOR_STEP) * MAJOR_STEP; yr <= now + SPAN && majors < MAX_MAJOR; yr += MAJOR_STEP, majors++) {
        const x = xOf(yr, now) * appear;
        majorArray.set([x, y, AXIS.z, x, y, AXIS.z + 0.009], majors * 6);
        const label = tickLabels[majors];
        if (label !== undefined) {
          label.position.x = x;
          setText(label, String(yr));
        }
      }
      tickLabels.forEach((label, i) => (label.visible = i < majors));
      let minors = 0;
      for (let yr = Math.ceil((now - SPAN) / MINOR_STEP) * MINOR_STEP; yr <= now + SPAN && minors < MAX_MINOR; yr += MINOR_STEP, minors++) {
        const x = xOf(yr, now) * appear;
        minorArray.set([x, y, AXIS.z, x, y, AXIS.z + 0.004], minors * 6);
      }
      majorAttribute.needsUpdate = true;
      minorAttribute.needsUpdate = true;
      majorGeometry.setDrawRange(0, majors * 2);
      minorGeometry.setDrawRange(0, minors * 2);

      for (const { year: yr, group } of markers) {
        const x = xOf(yr, now);
        group.position.set(x, 0, AXIS.z);
        group.visible = Math.abs(x) <= AXIS.halfWidth;
      }

      // 原点をまたいだ直後は、針とカウンタを光らせる
      const sinceUnix = beat - CROSS_UNIX;
      const sinceEra = beat - CROSS_ERA;
      const flash = Math.max(sinceUnix >= 0 ? Math.exp(-sinceUnix / 0.5) : 0, sinceEra >= 0 ? Math.exp(-sinceEra / 0.6) : 0);
      needleMaterial.color.set(flash > 0.3 ? PALETTE.glow : PALETTE.warm);
      yearLabel.color = sinceEra >= 0 && sinceEra < 1.5 ? PALETTE.warm : PALETTE.glow;
      yearLabel.scale.setScalar(1 + 0.25 * (sinceEra >= 0 ? Math.exp(-sinceEra / 0.35) : 0) + 0.04 * beatPulse(ctx, 0.3));
      fader.set(note, sinceEra >= 0 ? Math.min(1, sinceEra * 4) : 0);

      // 64 ビットのレジスタ。1970 年をまたいだ直後は反転したビットを白く光らせる
      const bits = int64Bits(unix);
      const flip = sinceUnix >= 0 ? Math.exp(-sinceUnix / 0.6) : 0;
      for (let i = 0; i < 64; i++) {
        if (bits[i] === true) {
          matrix.makeTranslation(cellCenter(i));
          cells.setMatrixAt(i, matrix);
          color.copy(i === 0 ? signColor : bitColor).lerp(flashColor, flip * (i < 30 ? 1 : 0));
          cells.setColorAt(i, color);
        } else {
          cells.setMatrixAt(i, hidden);
        }
      }
      cells.instanceMatrix.needsUpdate = true;
      if (cells.instanceColor !== null) cells.instanceColor.needsUpdate = true;
      setText(bitsCaption, unix < 0 ? "int64 two's complement   t < 0  ->  sign bit = 1" : "int64 two's complement   t >= 0");
    },
  };
});
