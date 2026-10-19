import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { DynamicLine, Fader, PALETTE, Y_INK, defineScene, easeInOutCubic, floorLabel, progress, stageFloor, standLabel } from './kit';

/**
 * #7 円周: 机に立てた円が1回転ぶん転がり、円周が床の直線に伸びる。縁の1点はサイクロイドを描く。
 * 伸びた長さに目盛り(r ごと)が入り、最後に 2πr が出る。2小節を想定。
 */

const R = 0.028;
const START_X = -0.15;
const ROLL: readonly [number, number] = [1, 6.5];
const TRACE_SAMPLES = 160;
const SPOKES = 6;

export const circle = defineScene('circle', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader));

  // 車輪(XY 面に立てた円とスポーク)。縁の印は最初に床と接している点
  const wheel = new Group();
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const rim = new LineBuilder().circle(new Vector3(), R, X, Y, 64);
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    rim.segment(new Vector3(), new Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const rimMaterial = fader.line(PALETTE.ink, 1);
  wheel.add(rim.build(rimMaterial));
  const mark = new LineBuilder().circle(new Vector3(0, -R, 0), 0.0025, X, Y, 12).build(fader.line(PALETTE.warm, 1));
  wheel.add(mark);
  root.add(wheel);

  // 伸びた円周(床の直線)と、r ごとの目盛り
  const unrolled = new LineBuilder().segment(new Vector3(0, Y_INK, 0), new Vector3(1, Y_INK, 0)).build(fader.line(PALETTE.warm, 1));
  unrolled.position.x = START_X;
  root.add(unrolled);
  const ticks = new LineBuilder();
  for (let k = 0; k <= 6; k++) ticks.segment(new Vector3(START_X + k * R, Y_INK, -0.004), new Vector3(START_X + k * R, Y_INK, 0.004));
  const tickLines = ticks.build(fader.line(PALETTE.ink, 0.8));
  root.add(tickLines);
  const tickCount = tickLines.geometry.getAttribute('position').count;

  // 縁の印の軌跡(サイクロイド)
  const cycloid = new DynamicLine(TRACE_SAMPLES, fader.line(PALETTE.cyan, 0.8));
  root.add(cycloid.line);

  const end = START_X + 2 * Math.PI * R;
  root.add(floorLabel(fader, '0', START_X, 0.016, { size: 0.0055 }));
  const result = floorLabel(fader, '2*pi*r', end, 0.016, { size: 0.0065, color: PALETTE.warm }, 0);
  root.add(result);
  root.add(standLabel(fader, 'C = 2*pi*r = 6.2832 r', -0.18, 0.11, -0.05, { anchorX: 'left', size: 0.0075 }));

  return {
    root,
    fader,
    update(beat) {
      fader.set(rimMaterial, Math.min(1, beat / 0.8));
      const theta = 2 * Math.PI * easeInOutCubic(progress(beat, ROLL));
      // 滑らずに転がる: 中心は rθ 進み、時計回り(−Z 軸まわり)に θ 回る
      wheel.position.set(START_X + R * theta, R, 0);
      wheel.rotation.z = -theta;
      unrolled.scale.x = Math.max(R * theta, 1e-4);
      tickLines.geometry.setDrawRange(0, Math.min(tickCount, (Math.floor((R * theta) / R + 1e-6) + 1) * 2));

      for (let i = 0; i < TRACE_SAMPLES; i++) {
        const s = (i / (TRACE_SAMPLES - 1)) * theta;
        cycloid.set(i, START_X + R * s - R * Math.sin(s), R - R * Math.cos(s) + Y_INK, 0);
      }
      cycloid.commit(theta > 0 ? TRACE_SAMPLES : 0);
      fader.set(result, progress(beat, [ROLL[1] - 0.3, ROLL[1] + 0.3]));
    },
  };
});
