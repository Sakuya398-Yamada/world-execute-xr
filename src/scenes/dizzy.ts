import { BoxGeometry, EdgesGeometry, Group, LineSegments, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { aliasFrequency } from '../sim/strobe';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
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
 * #11 めまい: 「見え方」が狂っていく図。
 * - 左: ストロボで照らした車輪(時間方向のエイリアシング)。本当は加速し続けているのに、
 *   光る間隔とスポークの周期の関係で、逆回転したり止まったりして見える。2小節目の頭と最後でぴたりと止まって見える
 * - 右: 宙に浮くリサージュ曲線が、位相のずれた2つの像に分かれて揺れる(二重像)
 * - 手前: 2つの位相ベクトルと、その和の波。位相差が π に近づくと打ち消し合って消える
 * 光学シースルーの端末では背景を暗くできないので、描いたものだけを明滅させる。明滅は車輪の周りに限り、強さに上限を設けている。
 * 2小節(8拍)を想定。
 */

/** 車輪のスポークの本数 */
const SPOKES = 8;
/** ストロボが光る回数 [回/拍](8分音符) */
const FLASHES_PER_BEAT = 2;
/** ストロボを始める拍(それまでは連続光で、回り始めた車輪がぶれて見える) */
const STROBE_FROM = 1.5;
/** 明滅の強さの上限(酔い・光過敏への配慮) */
const STROBE_MAX = 0.85;
/** 1回の光の残り方 [拍] */
const FLASH_DECAY = 0.12;
const WHEEL = { center: new Vector3(-0.105, 0.075, -0.045), radius: 0.045 } as const;

/**
 * 車輪の回転角 [スポークの周期]。1回光るあいだに進むスポークの周期の数が beat/4 になるように加速させる。
 * → 4拍目(2小節目の頭)と8拍目で、光るたびにちょうど1周期・2周期進み、止まって見える
 */
const wheelTurns = (beat: number): number => (beat * beat) / 4;

/** 車輪の回転角 [rad](時計回りに回すので負) */
const wheelAngle = (beat: number): number => -wheelTurns(beat) * ((2 * Math.PI) / SPOKES);

const LISSAJOUS = { center: new Vector3(0.075, 0.08, -0.04), size: new Vector3(0.075, 0.045, 0.045), samples: 360 } as const;
/** 2つの像の位相差の最大値 [rad]。最後に π になり、和が消える */
const MAX_SHIFT = Math.PI;

const PHASOR = { center: new Vector3(-0.15, Y_INK * 2, 0.085), radius: 0.026 } as const;
const WAVE = { x0: -0.105, x1: 0.045, z: 0.085, amp: 0.011, samples: 120 } as const;

/** 位相差 [rad]。前半はゆっくり、2小節目に入って π まで開く。拍に合わせて少し揺らす */
function phaseShift(beat: number): number {
  const base = MAX_SHIFT * (0.3 * smoothstep(progress(beat, [0.5, 3.5])) + 0.7 * smoothstep(progress(beat, [4, 7.75])));
  const wobble = 0.12 * Math.sin(beat * Math.PI) * progress(beat, [1, 2]) * (1 - progress(beat, [7, 7.75]));
  return base + wobble;
}

/** XY 面の円(車輪の輪など) */
function ring(builder: LineBuilder, radius: number, segments = 64): LineBuilder {
  return builder.circle(new Vector3(), radius, new Vector3(1, 0, 0), new Vector3(0, 1, 0), segments);
}

export const dizzy = defineScene('dizzy', (ctx) => {
  const fader = new Fader();
  const root = new Group();
  const spb = ctx.beats.secondsPerBeat;

  // ---- 車輪とストロボ ----
  const stand = new LineBuilder()
    .segment(new Vector3(WHEEL.center.x - 0.02, 0, WHEEL.center.z), new Vector3(WHEEL.center.x, WHEEL.center.y, WHEEL.center.z))
    .segment(new Vector3(WHEEL.center.x + 0.02, 0, WHEEL.center.z), new Vector3(WHEEL.center.x, WHEEL.center.y, WHEEL.center.z))
    .segment(new Vector3(WHEEL.center.x - 0.03, Y_INK, WHEEL.center.z), new Vector3(WHEEL.center.x + 0.03, Y_INK, WHEEL.center.z));
  root.add(stand.build(fader.line(PALETTE.dim, 0.7)));

  const wheelShape = ring(ring(new LineBuilder(), WHEEL.radius), WHEEL.radius * 0.93);
  ring(wheelShape, WHEEL.radius * 0.12, 16);
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    wheelShape.segment(
      new Vector3(Math.cos(a) * WHEEL.radius * 0.12, Math.sin(a) * WHEEL.radius * 0.12, 0),
      new Vector3(Math.cos(a) * WHEEL.radius * 0.93, Math.sin(a) * WHEEL.radius * 0.93, 0),
    );
  }
  // いまの像と、その前の2回分の残像(見かけの回転の向きがわかる)
  const wheels = [0, 1, 2].map((k) => {
    const material = fader.line(k === 0 ? PALETTE.glow : PALETTE.cyan, 0);
    const wheel = wheelShape.build(material);
    wheel.position.copy(WHEEL.center);
    wheel.position.z += k * 0.0004;
    root.add(wheel);
    return { wheel, material };
  });

  // ストロボの灯体(手前左の床から車輪を照らす)と、光の筋
  const lamp = new LineSegments(new EdgesGeometry(new BoxGeometry(0.016, 0.01, 0.012)), fader.line(PALETTE.ink, 0.8));
  lamp.position.set(-0.17, 0.006, 0.035);
  root.add(lamp);
  const beamMaterial = fader.line(PALETTE.warm, 0);
  const beam = new LineBuilder();
  for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    beam.segment(
      new Vector3(-0.17, 0.008, 0.03),
      new Vector3(WHEEL.center.x + Math.cos(a) * WHEEL.radius, WHEEL.center.y + Math.sin(a) * WHEEL.radius, WHEEL.center.z),
    );
  }
  root.add(beam.build(beamMaterial));

  root.add(standLabel(fader, `STROBE  f_s = ${(FLASHES_PER_BEAT / spb).toFixed(2)} Hz`, WHEEL.center.x, WHEEL.center.y + WHEEL.radius + 0.008, WHEEL.center.z, { size: 0.0055 }));
  const wheelReadout = standLabel(fader, '', WHEEL.center.x, WHEEL.center.y + WHEEL.radius + 0.018, WHEEL.center.z, { size: 0.0058, color: PALETTE.glow });
  root.add(wheelReadout);

  // ---- リサージュ曲線の二重像 ----
  const figure = new Group();
  figure.position.copy(LISSAJOUS.center);
  root.add(figure);
  const imageA = new DynamicLine(LISSAJOUS.samples, fader.line(PALETTE.cyan, 0.9));
  const imageBMaterial = fader.line(PALETTE.warm, 0.9);
  const imageB = new DynamicLine(LISSAJOUS.samples, imageBMaterial);
  figure.add(imageA.line, imageB.line);
  root.add(standLabel(fader, 'x = sin(3u + phi)  y = sin(2u)  z = sin(5u)', LISSAJOUS.center.x, 0.016, LISSAJOUS.center.z + 0.03, { size: 0.0048 }, 0.8));

  // ---- 位相ベクトルと、和の波(床) ----
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  root.add(new LineBuilder().circle(PHASOR.center, PHASOR.radius, X, Z, 64).segment(
    PHASOR.center.clone().add(new Vector3(-PHASOR.radius * 1.2, 0, 0)),
    PHASOR.center.clone().add(new Vector3(PHASOR.radius * 1.2, 0, 0)),
  ).build(fader.line(PALETTE.ink, 0.5)));
  const vecA = new DynamicLine(2, fader.line(PALETTE.cyan, 1));
  const vecB = new DynamicLine(2, fader.line(PALETTE.warm, 1));
  const vecSum = new DynamicLine(2, fader.line(PALETTE.glow, 1));
  root.add(vecA.line, vecB.line, vecSum.line);

  root.add(
    new LineBuilder()
      .segment(new Vector3(WAVE.x0, Y_INK, WAVE.z), new Vector3(WAVE.x1, Y_INK, WAVE.z))
      .build(fader.line(PALETTE.gridMajor, 0.4)),
  );
  const waveA = new DynamicLine(WAVE.samples, fader.line(PALETTE.cyan, 0.55));
  const waveB = new DynamicLine(WAVE.samples, fader.line(PALETTE.warm, 0.55));
  const waveSum = new DynamicLine(WAVE.samples, fader.line(PALETTE.glow, 1));
  root.add(waveA.line, waveB.line, waveSum.line);
  const phaseReadout = floorLabel(fader, '', WAVE.x0, WAVE.z + WAVE.amp * 2 + 0.012, { anchorX: 'left', size: 0.0058, color: PALETTE.glow });
  const sumReadout = floorLabel(fader, '', WAVE.x0, WAVE.z + WAVE.amp * 2 + 0.022, { anchorX: 'left', size: 0.0052 });
  root.add(phaseReadout, sumReadout);

  root.add(titleBlock(fader, 11, 'PHASE / STROBE', 'TEMPORAL ALIASING AND PHASE OFFSET'));

  const drawLissajous = (line: DynamicLine, phi: number): void => {
    const { x, y, z } = LISSAJOUS.size;
    for (let i = 0; i < LISSAJOUS.samples; i++) {
      const u = (i / (LISSAJOUS.samples - 1)) * Math.PI * 2;
      line.set(i, x * Math.sin(3 * u + phi), y * Math.sin(2 * u), z * Math.sin(5 * u));
    }
    line.commit(LISSAJOUS.samples);
  };
  const setVector = (line: DynamicLine, angle: number, length: number): void => {
    line.set(0, PHASOR.center.x, PHASOR.center.y, PHASOR.center.z);
    line.set(1, PHASOR.center.x + Math.cos(angle) * length, PHASOR.center.y, PHASOR.center.z - Math.sin(angle) * length);
    line.commit(2);
  };
  const setWheel = (k: number, angle: number, opacity: number): void => {
    const w = wheels[k];
    if (w === undefined) return;
    w.wheel.rotation.z = angle;
    fader.set(w.material, opacity);
  };
  let lastReadout = '';

  return {
    root,
    fader,
    update(beat, sceneCtx) {
      const appear = easeOutCubic(progress(beat, [0, 0.75]));

      // ---- 車輪 ----
      const b = Math.min(beat, 8);
      if (b < STROBE_FROM) {
        // 連続光: いまの角度と、少し前の角度を薄く重ねてぶれを出す
        setWheel(0, wheelAngle(b), 0.9 * appear);
        setWheel(1, wheelAngle(b - 0.06), 0.3 * appear);
        setWheel(2, wheelAngle(b - 0.12), 0.15 * appear);
        fader.set(beamMaterial, 0.15 * appear);
      } else {
        // ストロボ: 最後に光った瞬間の角度だけが見える。前の2回分は残像として薄く残す
        const k = Math.floor(b * FLASHES_PER_BEAT);
        const flashAt = k / FLASHES_PER_BEAT;
        const flash = Math.exp(-(beat - flashAt) / FLASH_DECAY);
        setWheel(0, wheelAngle(flashAt), 0.12 + STROBE_MAX * flash);
        setWheel(1, wheelAngle((k - 1) / FLASHES_PER_BEAT), 0.28);
        setWheel(2, wheelAngle((k - 2) / FLASHES_PER_BEAT), 0.12);
        fader.set(beamMaterial, 0.55 * flash);
      }
      // 実際の回転と、ストロボ越しの見かけの回転 [Hz](スポークの周波数で表す)
      const spokeHz = b / 2 / spb;
      const seen = b < STROBE_FROM ? spokeHz : aliasFrequency(spokeHz, FLASHES_PER_BEAT / spb);
      const readout = `f = ${spokeHz.toFixed(1)} Hz   seen ${seen >= 0 ? '+' : ''}${seen.toFixed(1)} Hz`;
      if (readout !== lastReadout) {
        lastReadout = readout;
        setText(wheelReadout, readout);
      }
      wheelReadout.color = b >= STROBE_FROM && Math.abs(seen) < 0.3 ? PALETTE.warm : PALETTE.glow;

      // ---- 二重像 ----
      const shift = phaseShift(beat);
      const phi = beat * 0.5;
      drawLissajous(imageA, phi);
      drawLissajous(imageB, phi + shift);
      imageB.line.position.x = 0.006 * Math.sin(shift);
      imageA.line.position.x = -0.006 * Math.sin(shift);
      figure.rotation.y = beat * 0.22;
      figure.rotation.z = 0.1 * Math.sin(beat * Math.PI * 0.5) * progress(beat, [1, 3]);
      figure.scale.setScalar(Math.max(appear, 1e-4));
      // 拍の頭で少しだけ明るくする(強い明滅は車輪だけに限る)
      fader.set(imageBMaterial, (0.55 + 0.3 * beatPulse(sceneCtx, 0.3)) * clamp01(shift * 3));

      // ---- 位相ベクトルと和の波 ----
      const omega = Math.PI; // [rad/拍]。2拍で1回転
      const theta = omega * beat;
      const r = PHASOR.radius;
      setVector(vecA, theta, r * appear);
      setVector(vecB, theta + shift, r * appear);
      const sumX = Math.cos(theta) + Math.cos(theta + shift);
      const sumY = Math.sin(theta) + Math.sin(theta + shift);
      setVector(vecSum, Math.atan2(sumY, sumX), (r / 2) * Math.hypot(sumX, sumY) * appear);
      for (let i = 0; i < WAVE.samples; i++) {
        const u = i / (WAVE.samples - 1);
        const x = WAVE.x0 + (WAVE.x1 - WAVE.x0) * u;
        const ph = u * Math.PI * 4 - theta;
        const a = Math.sin(ph);
        const c = Math.sin(ph + shift);
        waveA.set(i, x, Y_INK * 2, WAVE.z - WAVE.amp * a);
        waveB.set(i, x, Y_INK * 2, WAVE.z - WAVE.amp * c);
        waveSum.set(i, x, Y_INK * 3, WAVE.z - WAVE.amp * (a + c));
      }
      const count = Math.max(2, Math.round(appear * WAVE.samples));
      waveA.commit(count);
      waveB.commit(count);
      waveSum.commit(count);
      setText(phaseReadout, `dphi = ${shift.toFixed(2)} rad`);
      setText(sumReadout, `|A + B| = 2|cos(dphi/2)| = ${(2 * Math.abs(Math.cos(shift / 2))).toFixed(2)}`);
    },
  };
});
