import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineSegments, Points, PointsMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { KuramotoSim, orderParameter } from '../sim/kuramoto';
import { seededRandom } from '../sim/random';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  clamp01,
  defineScene,
  easeOutCubic,
  floorLabel,
  progress,
  setText,
  smoothstep,
  standLabel,
  titleBlock,
} from './kit';

/**
 * #13 深く一つになる: ばらばらに振れていた振り子が、結合が強まるにつれて位相がそろい、一斉に振れるようになる(蔵本モデル)。
 * 拍と同じ周期のペースメーカー(外からの駆動)にも引き込まれるので、同期すると振れの端が拍の頭に来る。
 * 手前の床には位相の円(各振り子の位相と、平均場 r e^(iψ))と、秩序変数 r の時間変化のグラフを出す。
 * 最後の1拍は振れの端で時間を止め、全体を光らせてサビの直前の「溜め」にする。2小節(8拍)を想定。
 */

const COUNT = 16;
const GANTRY = { z: -0.055, top: 0.13, halfSpan: 0.15 } as const;
const LENGTH = 0.085;
/** 振れの最大角 [rad]。溜めに向けて大きくする */
const SWING: readonly [number, number] = [0.42, 0.62];
/** 固有振動数のばらつき(中心の何割) */
const SPREAD = 0.3;
/** 結合 K と駆動 F を上げていく区間 [拍]と、最大値(中心の固有角振動数を単位) */
const COUPLE: readonly [number, number] = [1, 4.5];
const DRIVE: readonly [number, number] = [2.5, 5];
const K_MAX = 1.6;
const F_MAX = 0.8;
/** 振れの端で時間を止める拍(サビ直前の溜め) */
const HOLD = 7;
/** 1拍あたりの積分の刻み数 */
const STEPS_PER_BEAT = 96;
const TRAIL = 6;

const CIRCLE = { center: new Vector3(-0.125, Y_INK * 2, 0.075), radius: 0.032 } as const;
const PLOT = { x0: -0.06, x1: 0.055, z0: 0.1, z1: 0.045, samples: 160 } as const;

/** 角度を (−π, π] に折り返す */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export const kuramoto = defineScene('kuramoto', (ctx, length) => {
  const fader = new Fader();
  const root = new Group();

  // 中心の固有角振動数: 2拍で1往復(振れの端が毎拍に来る)
  const spb = ctx.beats.secondsPerBeat;
  const omega0 = Math.PI / spb;
  const random = seededRandom(13);
  const omegas = Array.from({ length: COUNT }, () => omega0 * (1 + SPREAD * (random() * 2 - 1)));
  const initial = Array.from({ length: COUNT }, () => random() * Math.PI * 2);
  const sim = new KuramotoSim(omegas, initial, spb / STEPS_PER_BEAT);
  /** 秩序変数の履歴(STEPS_PER_BEAT / 8 ごと) */
  const history: number[] = [];
  const driveAt = (beat: number): { k: number; f: number; omega: number } => ({
    k: K_MAX * omega0 * smoothstep(progress(beat, COUPLE)),
    f: F_MAX * omega0 * smoothstep(progress(beat, DRIVE)),
    omega: omega0,
  });

  // ---- 架台と振り子 ----
  const gantry = new LineBuilder()
    .segment(new Vector3(-GANTRY.halfSpan - 0.012, GANTRY.top, GANTRY.z), new Vector3(GANTRY.halfSpan + 0.012, GANTRY.top, GANTRY.z))
    .segment(new Vector3(-GANTRY.halfSpan - 0.012, 0, GANTRY.z - 0.012), new Vector3(-GANTRY.halfSpan - 0.012, GANTRY.top, GANTRY.z))
    .segment(new Vector3(-GANTRY.halfSpan - 0.012, 0, GANTRY.z + 0.012), new Vector3(-GANTRY.halfSpan - 0.012, GANTRY.top, GANTRY.z))
    .segment(new Vector3(GANTRY.halfSpan + 0.012, 0, GANTRY.z - 0.012), new Vector3(GANTRY.halfSpan + 0.012, GANTRY.top, GANTRY.z))
    .segment(new Vector3(GANTRY.halfSpan + 0.012, 0, GANTRY.z + 0.012), new Vector3(GANTRY.halfSpan + 0.012, GANTRY.top, GANTRY.z));
  const gantryMaterial = fader.line(PALETTE.ink, 0.8);
  root.add(gantry.build(gantryMaterial));
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const pivotX = (i: number): number => -GANTRY.halfSpan + (2 * GANTRY.halfSpan * i) / (COUNT - 1);
  const pendulums = Array.from({ length: COUNT }, (_, i) => {
    const pivot = new Group();
    pivot.position.set(pivotX(i), GANTRY.top, GANTRY.z);
    const material = fader.line(PALETTE.glow, 0.9);
    pivot.add(
      new LineBuilder()
        .segment(new Vector3(0, 0, 0), new Vector3(0, -LENGTH, 0))
        .circle(new Vector3(0, -LENGTH - 0.0055, 0), 0.0055, X, Y, 16)
        .circle(new Vector3(0, 0, 0), 0.0015, X, Y, 8)
        .build(material),
    );
    root.add(pivot);
    return { pivot, material };
  });
  // 振り子の軌跡(直前の位置を短い弧で残す)
  const trailArray = new Float32Array(COUNT * TRAIL * 6);
  const trailAttribute = new BufferAttribute(trailArray, 3);
  trailAttribute.setUsage(DynamicDrawUsage);
  const trailGeometry = new BufferGeometry();
  trailGeometry.setAttribute('position', trailAttribute);
  const trails = new LineSegments(trailGeometry, fader.line(PALETTE.cyan, 0.45));
  trails.frustumCulled = false;
  root.add(trails);

  // ---- 位相の円 ----
  root.add(new LineBuilder().circle(CIRCLE.center, CIRCLE.radius, X, Z, 64).build(fader.line(PALETTE.ink, 0.6)));
  const dotPositions = new BufferAttribute(new Float32Array(COUNT * 3), 3);
  dotPositions.setUsage(DynamicDrawUsage);
  const dotGeometry = new BufferGeometry();
  dotGeometry.setAttribute('position', dotPositions);
  const dots = new Points(dotGeometry, fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.0042, depthWrite: false })));
  dots.frustumCulled = false;
  root.add(dots);
  const meanField = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  const pacemaker = new DynamicLine(2, fader.line(PALETTE.cyan, 0.8));
  root.add(meanField.line, pacemaker.line);
  root.add(floorLabel(fader, 'r e^(i psi)', CIRCLE.center.x, CIRCLE.center.z + CIRCLE.radius + 0.01, { size: 0.0052, color: PALETTE.warm }));
  root.add(floorLabel(fader, 'pacemaker', CIRCLE.center.x, CIRCLE.center.z - CIRCLE.radius - 0.008, { size: 0.0045, color: PALETTE.cyan }, 0.8));

  // ---- r(t) のグラフ(床) ----
  const plotFrame = new LineBuilder()
    .segment(new Vector3(PLOT.x0, Y_INK, PLOT.z0), new Vector3(PLOT.x1, Y_INK, PLOT.z0))
    .segment(new Vector3(PLOT.x0, Y_INK, PLOT.z0), new Vector3(PLOT.x0, Y_INK, PLOT.z1 - 0.004));
  for (let x = PLOT.x0; x <= PLOT.x1 + 1e-6; x += (PLOT.x1 - PLOT.x0) / 8) {
    plotFrame.segment(new Vector3(x, Y_INK, PLOT.z0), new Vector3(x, Y_INK, PLOT.z0 + 0.003));
  }
  root.add(plotFrame.build(fader.line(PALETTE.ink, 0.7)));
  const one = new LineBuilder();
  for (let x = PLOT.x0; x < PLOT.x1; x += 0.006) one.segment(new Vector3(x, Y_INK, PLOT.z1), new Vector3(Math.min(x + 0.003, PLOT.x1), Y_INK, PLOT.z1));
  root.add(one.build(fader.line(PALETTE.warm, 0.5)));
  root.add(floorLabel(fader, '1', PLOT.x0 - 0.006, PLOT.z1, { size: 0.0048, color: PALETTE.warm }));
  root.add(floorLabel(fader, 'r(t)', PLOT.x0 + 0.004, PLOT.z1 - 0.009, { size: 0.0052, anchorX: 'left' }));
  const rCurve = new DynamicLine(PLOT.samples, fader.line(PALETTE.glow, 1));
  const kCurve = new DynamicLine(PLOT.samples, fader.line(PALETTE.dim, 0.7));
  root.add(rCurve.line, kCurve.line);
  const readout = floorLabel(fader, '', PLOT.x1 + 0.004, PLOT.z1 + 0.006, { size: 0.0068, anchorX: 'left', color: PALETTE.glow });
  root.add(readout);
  root.add(floorLabel(fader, 'K', PLOT.x1 + 0.004, PLOT.z1 + 0.018, { size: 0.0048, anchorX: 'left', color: PALETTE.dim }));

  root.add(
    standLabel(fader, "phi_i' = w_i + K r sin(psi - phi_i) + F sin(W t - phi_i)", -GANTRY.halfSpan, GANTRY.top + 0.012, GANTRY.z, {
      size: 0.0056,
      anchorX: 'left',
    }),
  );
  root.add(titleBlock(fader, 13, 'PHASE SYNC', 'KURAMOTO MODEL WITH A PACEMAKER'));

  const lockedColor = new Color(PALETTE.glow);
  const freeColor = new Color(PALETTE.cyan);
  const holdColor = new Color(PALETTE.warm);
  const end = Math.max(length, HOLD + 1);

  return {
    root,
    fader,
    update(beat) {
      // 積分(巻き戻されたら最初から)。表示は HOLD で止めるが、計算はそこまででよい
      const target = Math.min(beat, HOLD);
      if (target * spb < sim.time - 1e-9) {
        sim.reset();
        history.length = 0;
      }
      while (sim.time + sim.h <= target * spb + 1e-9) {
        const b = sim.time / spb;
        if (Math.round(b * STEPS_PER_BEAT) % (STEPS_PER_BEAT / 8) === 0) history.push(orderParameter(sim.phases).r);
        sim.advance(driveAt(b));
      }
      const { r, psi } = orderParameter(sim.phases);
      const hold = progress(beat, [HOLD - 0.25, HOLD + 0.25]);
      const tension = smoothstep(progress(beat, [5, HOLD]));
      const swing = SWING[0] + (SWING[1] - SWING[0]) * tension;
      const appear = easeOutCubic(progress(beat, [0, 0.75]));

      // 振り子(角度 = 振れ × cos φ。同期して駆動に引き込まれると、端が拍の頭に来る)
      let t = 0;
      pendulums.forEach(({ pivot, material }, i) => {
        const p = sim.phases[i] ?? 0;
        pivot.rotation.z = swing * appear * Math.cos(p);
        const lock = 1 - clamp01(Math.abs(wrap(p - psi)) / 1.2);
        material.color.copy(freeColor).lerp(lockedColor, lock * r).lerp(holdColor, hold * 0.8);
        // 軌跡: 直前の位相へ少しずつ戻した位置
        const w = omegas[i] ?? omega0;
        for (let k = 0; k < TRAIL; k++) {
          const a0 = swing * appear * Math.cos(p - w * spb * 0.06 * k);
          const a1 = swing * appear * Math.cos(p - w * spb * 0.06 * (k + 1));
          const x = pivotX(i);
          const l = LENGTH + 0.0055;
          trailArray.set(
            [x + Math.sin(a0) * l, GANTRY.top - Math.cos(a0) * l, GANTRY.z, x + Math.sin(a1) * l, GANTRY.top - Math.cos(a1) * l, GANTRY.z],
            t * 6,
          );
          t++;
        }
      });
      trailAttribute.needsUpdate = true;
      trailGeometry.setDrawRange(0, beat >= HOLD ? 0 : t * 2);
      fader.set(gantryMaterial, 0.8 + 0.2 * hold);

      // 位相の円
      for (let i = 0; i < COUNT; i++) {
        const p = sim.phases[i] ?? 0;
        dotPositions.setXYZ(i, CIRCLE.center.x + CIRCLE.radius * Math.cos(p), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * Math.sin(p));
      }
      dotPositions.needsUpdate = true;
      meanField.set(0, CIRCLE.center.x, CIRCLE.center.y, CIRCLE.center.z);
      meanField.set(1, CIRCLE.center.x + CIRCLE.radius * r * Math.cos(psi), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * r * Math.sin(psi));
      meanField.commit(2);
      const external = omega0 * sim.time;
      pacemaker.set(0, CIRCLE.center.x + CIRCLE.radius * 1.12 * Math.cos(external), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * 1.12 * Math.sin(external));
      pacemaker.set(1, CIRCLE.center.x + CIRCLE.radius * 1.32 * Math.cos(external), CIRCLE.center.y, CIRCLE.center.z - CIRCLE.radius * 1.32 * Math.sin(external));
      pacemaker.commit(beat >= DRIVE[0] ? 2 : 0);

      // r(t) と K(t) のグラフ(横軸はシーンの8拍)
      const shown = Math.min(history.length, PLOT.samples);
      for (let k = 0; k < shown; k++) {
        const b = k / 8;
        const x = PLOT.x0 + ((PLOT.x1 - PLOT.x0) * b) / end;
        rCurve.set(k, x, Y_INK * 2, PLOT.z0 + (PLOT.z1 - PLOT.z0) * (history[k] ?? 0));
        kCurve.set(k, x, Y_INK * 1.5, PLOT.z0 + (PLOT.z1 - PLOT.z0) * (driveAt(b).k / (K_MAX * omega0)) * 0.9);
      }
      rCurve.commit(shown);
      kCurve.commit(shown);
      setText(readout, r > 0.97 && beat >= HOLD - 0.25 ? `r = ${r.toFixed(2)}  SYNC` : `r = ${r.toFixed(2)}`);
      readout.color = beat >= HOLD - 0.25 ? PALETTE.warm : PALETTE.glow;
    },
  };
});
