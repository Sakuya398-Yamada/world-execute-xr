import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { DynamicLine, Fader, PALETTE, beatPulse, defineScene, progress, setText, standLabel } from './kit';

/**
 * #11 めまい: 宙に浮くリサージュ曲線が、位相のずれた2つの像に分かれて揺れる。拍ごとにストロボのように明滅する。
 * 光学シースルーの端末では背景を暗くできないので、描いたものだけをずらす。明滅は弱めに抑えている。2小節を想定。
 */

const CENTER = new Vector3(0, 0.085, -0.01);
const SIZE = { x: 0.1, y: 0.05, z: 0.06 } as const;
const SAMPLES = 400;
/** 2つの像の位相差が開いていく区間 [拍]と、その最大値 [rad] */
const SPLIT: readonly [number, number] = [1, 4];
const MAX_SHIFT = 0.7;
/** 明滅の強さ(0〜1)。酔い対策で上限を設けている */
const STROBE = 0.45;
const RIPPLES = 4;

export const dizzy = defineScene('dizzy', () => {
  const fader = new Fader();
  const root = new Group();

  const figure = new Group();
  figure.position.copy(CENTER);
  root.add(figure);
  const materialA = fader.line(PALETTE.cyan, 0.9);
  const materialB = fader.line(PALETTE.warm, 0.9);
  const imageA = new DynamicLine(SAMPLES, materialA);
  const imageB = new DynamicLine(SAMPLES, materialB);
  figure.add(imageA.line, imageB.line);

  // 床に広がる波紋(拍ごとに1つ)
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const ripples = Array.from({ length: RIPPLES }, () => {
    const material = fader.line(PALETTE.dim, 0);
    const ring = new LineBuilder().circle(new Vector3(0, 0.001, 0), 1, X, Z, 64).build(material);
    root.add(ring);
    return { ring, material };
  });

  const readout = standLabel(fader, '', -0.18, 0.012, -0.12, { anchorX: 'left', anchorY: 'bottom', size: 0.0075, color: PALETTE.glow });
  root.add(readout);
  root.add(standLabel(fader, 'x = sin(3u + phi), y = sin(2u), z = sin(5u)', -0.18, 0.004, -0.12, { anchorX: 'left', anchorY: 'bottom', size: 0.005 }));

  const draw = (line: DynamicLine, phi: number, wobble: number): void => {
    for (let i = 0; i < SAMPLES; i++) {
      const u = (i / (SAMPLES - 1)) * Math.PI * 2;
      line.set(i, SIZE.x * Math.sin(3 * u + phi) + wobble, SIZE.y * Math.sin(2 * u), SIZE.z * Math.sin(5 * u));
    }
    line.commit(SAMPLES);
  };

  return {
    root,
    fader,
    update(beat, ctx) {
      const shift = MAX_SHIFT * progress(beat, SPLIT) * (0.75 + 0.25 * Math.sin(beat * Math.PI * 0.5));
      const phi = beat * 0.6;
      draw(imageA, phi, -0.004 * shift);
      draw(imageB, phi + shift, 0.004 * shift);
      figure.rotation.y = beat * 0.25;
      figure.rotation.z = 0.08 * Math.sin(beat * Math.PI * 0.5) * progress(beat, SPLIT);

      const flash = STROBE * beatPulse(ctx, 0.25) * progress(beat, [0.5, 1.5]);
      fader.set(materialA, 0.55 + flash);
      fader.set(materialB, (0.35 + flash) * Math.min(1, shift * 4));

      ripples.forEach(({ ring, material }, k) => {
        // k 拍前に生まれた波紋
        const age = ctx.beat.phase + k;
        ring.scale.setScalar(0.02 + age * 0.05);
        fader.set(material, Math.max(0, 0.5 - age * 0.14));
      });
      setText(readout, `dphi = ${shift.toFixed(2)} rad`);
    },
  };
});
