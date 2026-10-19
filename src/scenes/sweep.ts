import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { Fader, PALETTE, Y_INK, defineScene, floorLabel } from './kit';
import { SpinField } from './spinField';

/**
 * #14 すべてのシミュレーションを: #5 の小さな世界が机に 3 × 2 並び、それぞれ違うパラメータ(D, B)で緩和していく。
 * 一様な磁化・迷路状のドメイン・スキルミオンと、パラメータによって違う模様になる。
 * 後半(2小節目以降)は、スキルミオンが出た1つだけを残して他を暗くする(SATISFACTION の行)。4小節を想定。
 */

const NX = 14;
const NY = 10;
const PITCH = 0.0068;
const WORLDS = [
  { d: 0.4, b: 0.0 },
  { d: 0.8, b: 0.0 },
  { d: 1.2, b: 0.0 },
  { d: 0.4, b: 0.6 },
  { d: 0.8, b: 0.4 },
  { d: 1.2, b: 0.6 },
] as const;
/** 選ばれる世界(スキルミオンが出るもの) */
const CHOSEN = 5;
/** i 番目の世界が動き出す拍 */
const startAt = (i: number): number => 0.25 + i * 0.4;
/** 1つに絞る拍 */
const SELECT = 8;

export const sweep = defineScene('sweep', () => {
  const fader = new Fader();
  const root = new Group();

  const width = NX * PITCH;
  const depth = NY * PITCH;
  const worlds = WORLDS.map((params, i) => {
    const center = new Vector3((i % 3 - 1) * 0.125, 0, i < 3 ? -0.055 : 0.06);
    const field = new SpinField(NX, NY, { j: 1, rate: 0.15, ...params }, 20 + i, PITCH, center, fader);
    root.add(field.mesh);
    const frameMaterial = fader.line(PALETTE.ink, 0.6);
    const w = width / 2 + 0.004;
    const d = depth / 2 + 0.004;
    const frame = new LineBuilder()
      .polyline(
        [new Vector3(-w, Y_INK, -d), new Vector3(w, Y_INK, -d), new Vector3(w, Y_INK, d), new Vector3(-w, Y_INK, d)],
        true,
      )
      .build(frameMaterial);
    frame.position.copy(center);
    root.add(frame);
    const label = floorLabel(fader, `D=${params.d.toFixed(1)}  B=${params.b.toFixed(1)}`, center.x, center.z + d + 0.008, { size: 0.0052 });
    root.add(label);
    return { field, frameMaterial, label };
  });

  return {
    root,
    fader,
    update(beat) {
      worlds.forEach(({ field, frameMaterial, label }, i) => {
        const local = beat - startAt(i);
        field.advanceTo(Math.max(local, 0));
        field.draw(local < 0 ? 0 : Infinity);
        const chosen = i === CHOSEN;
        const dim = beat < SELECT ? 1 : chosen ? 1 : Math.max(0.25, 1 - (beat - SELECT) * 1.5);
        fader.set(field.material, dim);
        fader.set(label, dim);
        frameMaterial.color.set(chosen && beat >= SELECT ? PALETTE.warm : PALETTE.ink);
        fader.set(frameMaterial, chosen && beat >= SELECT ? 1 : 0.6 * dim);
      });
    },
  };
});
