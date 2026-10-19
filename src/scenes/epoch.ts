import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineSegments, Vector3 } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { Fader, PALETTE, Y_INK, defineScene, floorLabel, progress, setText, stageFloor, standLabel } from './kit';

/**
 * #12 紀元後から紀元前へ: 机を横切る時間軸が流れ、カウンタが 2026 年から紀元前へさかのぼる。
 * 途中で Unix 時間の原点(1970年)と、紀元前後の境目(1年 → 紀元前1年。0年は無い)をまたぐ。2小節を想定。
 */

const Z = 0.03;
const HALF_WIDTH = 0.18;
/** 軸の片側に見せる年数 */
const SPAN = 2500;
const TICK_STEP = 500;
const FROM_YEAR = 2026;
/** さかのぼる先(天文学的な年。−3000 は紀元前 3001 年) */
const TO_YEAR = -3000;
const RUN: readonly [number, number] = [0.5, 7.5];
const SECONDS_PER_YEAR = 365.2425 * 86400;
const MAX_TICKS = Math.ceil((2 * SPAN) / TICK_STEP) + 2;

/** 天文学的な年(0 = 紀元前1年)を AD / BC の表記にする */
function era(year: number): string {
  return year >= 1 ? `AD ${year}` : `BC ${1 - year}`;
}

export const epoch = defineScene('epoch', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader));

  root.add(new LineBuilder().segment(new Vector3(-HALF_WIDTH, Y_INK, Z), new Vector3(HALF_WIDTH, Y_INK, Z)).build(fader.line(PALETTE.ink, 0.8)));
  // 「今」を指す針
  const needleMaterial = fader.line(PALETTE.warm, 1);
  root.add(new LineBuilder().segment(new Vector3(0, 0, Z), new Vector3(0, 0.045, Z)).build(needleMaterial));

  // 流れる目盛り(毎フレーム位置を書き換える)と、その年のラベル
  const tickArray = new Float32Array(MAX_TICKS * 6);
  const tickAttribute = new BufferAttribute(tickArray, 3);
  tickAttribute.setUsage(DynamicDrawUsage);
  const tickGeometry = new BufferGeometry();
  tickGeometry.setAttribute('position', tickAttribute);
  const ticks = new LineSegments(tickGeometry, fader.line(PALETTE.ink, 0.7));
  ticks.frustumCulled = false;
  root.add(ticks);
  const tickLabels: Text[] = Array.from({ length: MAX_TICKS }, () => {
    const label = floorLabel(fader, '', 0, Z + 0.016, { size: 0.0048 }, 0.8);
    root.add(label);
    return label;
  });

  // 原点の印: Unix 時間の 0(1970年)と、紀元前後の境目(1年と0年の間)
  const markers = [
    { year: 1970, text: 'unix 0' },
    { year: 0.5, text: 'AD | BC' },
  ].map(({ year, text }) => {
    const line = new LineBuilder().segment(new Vector3(0, 0, 0), new Vector3(0, 0.025, 0)).build(fader.line(PALETTE.cyan, 1));
    const label = standLabel(fader, text, 0, 0.03, 0, { size: 0.005, color: PALETTE.cyan, anchorY: 'bottom' });
    const group = new Group();
    group.add(line, label);
    root.add(group);
    return { year, group };
  });

  const yearLabel = standLabel(fader, '', 0, 0.075, Z, { size: 0.014, color: PALETTE.glow, anchorY: 'bottom' });
  const unixLabel = standLabel(fader, '', 0, 0.058, Z, { size: 0.0065, anchorY: 'bottom' });
  root.add(yearLabel, unixLabel);

  const xOf = (year: number, now: number): number => ((year - now) / SPAN) * HALF_WIDTH;

  return {
    root,
    fader,
    update(beat) {
      // ゆっくり動き出し、だんだん速くさかのぼる
      const now = FROM_YEAR - (FROM_YEAR - TO_YEAR) * progress(beat, RUN) ** 2.2;
      const year = Math.floor(now);
      setText(yearLabel, era(year));
      setText(unixLabel, `unix t = ${Math.round((now - 1970) * SECONDS_PER_YEAR)} s`);

      const first = Math.ceil((now - SPAN) / TICK_STEP) * TICK_STEP;
      let count = 0;
      for (let y = first; y <= now + SPAN && count < MAX_TICKS; y += TICK_STEP, count++) {
        const x = xOf(y, now);
        tickArray.set([x, Y_INK, Z, x, Y_INK, Z + 0.008], count * 6);
        const label = tickLabels[count];
        if (label !== undefined) {
          label.position.x = x;
          setText(label, y === 0 ? '0' : String(y));
        }
      }
      tickAttribute.needsUpdate = true;
      tickGeometry.setDrawRange(0, count * 2);
      tickLabels.forEach((label, i) => (label.visible = i < count));

      for (const { year: y, group } of markers) {
        const x = xOf(y, now);
        group.position.set(x, 0, Z);
        group.visible = Math.abs(x) <= HALF_WIDTH;
      }
      // 原点をまたいだ直後は針を光らせる
      const crossed = markers.some(({ year: y }) => Math.abs(xOf(y, now)) < 0.004);
      needleMaterial.color.set(crossed ? PALETTE.glow : PALETTE.warm);
    },
  };
});
