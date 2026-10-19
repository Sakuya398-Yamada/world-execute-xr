import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Group, Points, PointsMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { seededRandom } from '../sim/random';
import { DynamicLine, Fader, PALETTE, Y_INK, defineScene, floorLabel, progress, setText } from './kit';

/**
 * #13 深く一つになる: ばらばらに振れていた振り子が、結合が強まるにつれて位相がそろい、一斉に振れるようになる(蔵本モデル)。
 * 手前の床には位相の円(各振り子の位相と、平均場 r e^(iψ))を出す。2小節を想定。
 */

const COUNT = 16;
const TOP = 0.13;
const LENGTH = 0.085;
const SPAN = 0.15;
const SWING = 0.45;
/** 固有振動数のばらつき(中心の何割) */
const SPREAD = 0.3;
/** 結合の強さを上げていく区間 [拍]と、最大値(中心の固有角振動数を単位) */
const COUPLE: readonly [number, number] = [1.5, 4.5];
const K_MAX = 1.6;
/** 積分の刻み [s] */
const STEP = 1 / 240;
const CIRCLE = { center: new Vector3(0, Y_INK, 0.085), radius: 0.035 } as const;

export const kuramoto = defineScene('kuramoto', (ctx) => {
  const fader = new Fader();
  const root = new Group();

  // 中心の固有角振動数: 2拍で1往復
  const spb = ctx.beats.secondsPerBeat;
  const omega0 = Math.PI / spb;
  const random = seededRandom(13);
  const omega = Array.from({ length: COUNT }, () => omega0 * (1 + SPREAD * (random() * 2 - 1)));
  const initial = Array.from({ length: COUNT }, () => random() * Math.PI * 2);
  const phase = [...initial];
  let simTime = 0;

  // 架台と振り子
  const frame = new LineBuilder()
    .segment(new Vector3(-SPAN - 0.01, TOP, 0), new Vector3(SPAN + 0.01, TOP, 0))
    .segment(new Vector3(-SPAN - 0.01, 0, 0), new Vector3(-SPAN - 0.01, TOP, 0))
    .segment(new Vector3(SPAN + 0.01, 0, 0), new Vector3(SPAN + 0.01, TOP, 0));
  root.add(frame.build(fader.line(PALETTE.ink, 0.8)));
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const pendulums = Array.from({ length: COUNT }, (_, i) => {
    const pivot = new Group();
    pivot.position.set(-SPAN + (2 * SPAN * i) / (COUNT - 1), TOP, 0);
    pivot.add(
      new LineBuilder()
        .segment(new Vector3(0, 0, 0), new Vector3(0, -LENGTH, 0))
        .circle(new Vector3(0, -LENGTH - 0.005, 0), 0.005, X, Y, 16)
        .build(fader.line(PALETTE.glow, 0.9)),
    );
    root.add(pivot);
    return pivot;
  });

  // 位相の円
  const Z = new Vector3(0, 0, 1);
  root.add(new LineBuilder().circle(CIRCLE.center, CIRCLE.radius, X, Z, 64).build(fader.line(PALETTE.ink, 0.6)));
  const dotPositions = new Float32BufferAttribute(new Float32Array(COUNT * 3), 3);
  dotPositions.setUsage(DynamicDrawUsage);
  const dotGeometry = new BufferGeometry();
  dotGeometry.setAttribute('position', dotPositions);
  const dots = new Points(dotGeometry, fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.004, depthWrite: false })));
  dots.frustumCulled = false;
  root.add(dots);
  const meanField = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  root.add(meanField.line);
  root.add(floorLabel(fader, "phi_i' = w_i + K r sin(psi - phi_i)", -0.18, 0.135, { anchorX: 'left', size: 0.0055 }));
  const readout = floorLabel(fader, '', CIRCLE.center.x + CIRCLE.radius + 0.01, CIRCLE.center.z, { anchorX: 'left', size: 0.0065, color: PALETTE.warm });
  root.add(readout);

  /** 平均場 r e^(iψ) */
  const order = (): { r: number; psi: number } => {
    let re = 0;
    let im = 0;
    for (const p of phase) {
      re += Math.cos(p);
      im += Math.sin(p);
    }
    return { r: Math.hypot(re, im) / COUNT, psi: Math.atan2(im, re) };
  };

  return {
    root,
    fader,
    update(beat) {
      const t = beat * spb;
      if (t < simTime) {
        // 巻き戻されたら最初から計算し直す
        phase.splice(0, COUNT, ...initial);
        simTime = 0;
      }
      while (simTime + STEP <= t) {
        const k = K_MAX * omega0 * progress(simTime / spb, COUPLE);
        const { r, psi } = order();
        for (let i = 0; i < COUNT; i++) {
          phase[i] = (phase[i] ?? 0) + STEP * ((omega[i] ?? omega0) + k * r * Math.sin(psi - (phase[i] ?? 0)));
        }
        simTime += STEP;
      }

      pendulums.forEach((pivot, i) => {
        pivot.rotation.z = SWING * Math.sin(phase[i] ?? 0);
      });
      phase.forEach((p, i) => {
        dotPositions.setXYZ(i, CIRCLE.center.x + CIRCLE.radius * Math.cos(p), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * Math.sin(p));
      });
      dotPositions.needsUpdate = true;
      const { r, psi } = order();
      meanField.set(0, CIRCLE.center.x, CIRCLE.center.y, CIRCLE.center.z);
      meanField.set(1, CIRCLE.center.x + CIRCLE.radius * r * Math.cos(psi), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * r * Math.sin(psi));
      meanField.commit(2);
      setText(readout, `r = ${r.toFixed(2)}`);
    },
  };
});
