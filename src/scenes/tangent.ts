import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { DynamicLine, Fader, PALETTE, defineScene, easeInOutCubic, progress, setText, stageFloor, standLabel } from './kit';

/**
 * #8 接線: 机の上を正弦波が流れ、その上を接線が滑っていく。下には導関数(cos)が並んで流れ、接線の傾きと同じ値を指す。
 * 2小節を想定。
 */

const X0 = -0.16;
const X1 = 0.16;
const Z = -0.03;
const SIN_Y = 0.085;
const COS_Y = 0.03;
const AMP = 0.022;
/** 波数 [rad/m](幅に1.5波長) */
const K = (2 * Math.PI * 1.5) / (X1 - X0);
/** 位相の進み [rad/拍](2拍で1周期) */
const OMEGA = Math.PI;
const SAMPLES = 160;
const SLIDE: readonly [number, number] = [1, 7];
const TANGENT_HALF = 0.035;

export const tangent = defineScene('tangent', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader));

  const baselines = new LineBuilder()
    .segment(new Vector3(X0, SIN_Y, Z), new Vector3(X1, SIN_Y, Z))
    .segment(new Vector3(X0, COS_Y, Z), new Vector3(X1, COS_Y, Z));
  root.add(baselines.build(fader.line(PALETTE.gridMajor, 0.35)));
  const sine = new DynamicLine(SAMPLES, fader.line(PALETTE.glow, 1));
  const cosine = new DynamicLine(SAMPLES, fader.line(PALETTE.cyan, 0.85));
  root.add(sine.line, cosine.line);

  // 接線、接点、導関数の上の対応する点、それらを結ぶ縦の補助線
  const tangentLine = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  const guide = new DynamicLine(2, fader.line(PALETTE.warm, 0.4));
  root.add(tangentLine.line, guide.line);
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const dot = new LineBuilder().circle(new Vector3(), 0.003, X, Y, 12).build(fader.line(PALETTE.warm, 1));
  const dotOnCos = new LineBuilder().circle(new Vector3(), 0.003, X, Y, 12).build(fader.line(PALETTE.warm, 1));
  root.add(dot, dotOnCos);

  root.add(standLabel(fader, 'y = sin(x)', X0, SIN_Y + AMP + 0.008, Z, { anchorX: 'left' }));
  root.add(standLabel(fader, "y' = cos(x)", X0, COS_Y + AMP + 0.008, Z, { anchorX: 'left', color: PALETTE.cyan }));
  const slope = standLabel(fader, '', 0, 0, Z, { size: 0.0055, color: PALETTE.warm, anchorY: 'bottom' });
  root.add(slope);

  /** 位置 x の位相 */
  const phaseAt = (x: number, beat: number): number => K * (x - X0) - OMEGA * beat;

  return {
    root,
    fader,
    update(beat) {
      const draw = Math.min(1, beat / 0.75);
      const count = Math.max(2, Math.round(draw * SAMPLES));
      for (let i = 0; i < count; i++) {
        const x = X0 + ((X1 - X0) * i) / (SAMPLES - 1);
        const ph = phaseAt(x, beat);
        sine.set(i, x, SIN_Y + AMP * Math.sin(ph), Z);
        cosine.set(i, x, COS_Y + AMP * Math.cos(ph), Z);
      }
      sine.commit(count);
      cosine.commit(count);

      const px = -0.12 + 0.24 * easeInOutCubic(progress(beat, SLIDE));
      const ph = phaseAt(px, beat);
      const py = SIN_Y + AMP * Math.sin(ph);
      const d = AMP * K * Math.cos(ph);
      const n = Math.hypot(1, d);
      tangentLine.set(0, px - TANGENT_HALF / n, py - (TANGENT_HALF * d) / n, Z + 0.0005);
      tangentLine.set(1, px + TANGENT_HALF / n, py + (TANGENT_HALF * d) / n, Z + 0.0005);
      tangentLine.commit(beat >= SLIDE[0] - 0.5 ? 2 : 0);
      const cy = COS_Y + AMP * Math.cos(ph);
      guide.set(0, px, py, Z);
      guide.set(1, px, cy, Z);
      guide.commit(beat >= SLIDE[0] - 0.5 ? 2 : 0);
      dot.position.set(px, py, Z + 0.0005);
      dotOnCos.position.set(px, cy, Z + 0.0005);
      slope.position.set(px, py + 0.012, Z);
      setText(slope, `slope = ${Math.cos(ph).toFixed(2)}`);
    },
  };
});
