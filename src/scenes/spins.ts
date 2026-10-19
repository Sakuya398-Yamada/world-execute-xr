import { Color, DataTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace, Vector3 } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { findDomains } from '../sim/topology';
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
import { scopePanel } from './parts/scope';
import { SPIN_STEPS_PER_BEAT, SpinField } from './spinField';

/**
 * #5 シミュレーション: 机いっぱいの2次元スピン格子(交換 + ブロッホ型 DM 相互作用 + 磁場)。10小節を想定。
 * - 0〜8拍(7〜8小節): 新しい世界を用意する。枠が描かれ、格子が中心から広がり、向きがばらばらの「熱い」状態でゆらぐ。
 *   後半の4拍は急冷までの秒読み
 * - 8拍目(9小節目、曲が盛り上がる): 磁場 B = 0.45 の中へ急冷し、緩和を始める。迷路状のドメインとスキルミオンが一斉に生まれる
 * - 20〜34拍: 磁場を 1.2 まで上げる。迷路の切れ端が縮んでちぎれ、丸いスキルミオンの集まりになる
 * - 30拍〜: スキルミオンの芯を探して印をつけ、数える
 * 奥のパネルにトポロジカル電荷 Q と磁場 B の時間変化を描く。Q も E も格子から実際に計算している(src/sim/spinLattice.ts)。
 */

const NX = 34;
const NY = 22;
const PITCH = 0.01;
const CENTER = new Vector3(0, 0, -0.012);
const W = NX * PITCH;
const D = NY * PITCH;
const PARAMS = { j: 1, d: 1.4, b: 0.45, rate: 0.15 } as const;

/** 急冷して緩和を始める拍(9小節目) */
const QUENCH = 8;
const FRAME_DRAW: readonly [number, number] = [0, 1.5];
const REVEAL: readonly [number, number] = [1.5, 3.5];
/** 急冷までの秒読み */
const COUNTDOWN = 4;
/** 磁場: 急冷後は RELAX、RAMP の区間で MAX まで上げる */
const FIELD = { relax: 0.45, max: 1.2, ramp: [20, 34] as const };
/** 芯に印をつけ始める拍 */
const MARK_FROM = 30;
/** c 成分がこれより小さい格子点のまとまりを芯とみなす。大きすぎるまとまり(迷路状のドメイン)は除く */
const CORE_THRESHOLD = -0.5;
const CORE_MAX_SIZE = 40;
/** パネルの横軸の終わり(シーンの最後) */
const PLOT_END = 40;

/** 何ステップごとに Q を記録するか */
const SAMPLE_STEPS = 4;
const MAX_SAMPLES = Math.ceil(((PLOT_END + 1 - QUENCH) * SPIN_STEPS_PER_BEAT) / SAMPLE_STEPS) + 1;
/** パネルの縦軸: −Q と B の最大 */
const Q_SCALE = 16;
const B_SCALE = 1.4;
const MAX_RINGS = 32;

/** シーンの拍での磁場 */
function fieldAt(beat: number): number {
  const k = smoothstep(progress(beat, FIELD.ramp));
  return FIELD.relax + (FIELD.max - FIELD.relax) * k;
}

/** パネルの横軸の位置 */
const plotU = (beat: number): number => clamp01((beat - QUENCH) / (PLOT_END - QUENCH));
/** k 番目の記録の拍 */
const sampleBeat = (k: number): number => QUENCH + ((k + 1) * SAMPLE_STEPS) / SPIN_STEPS_PER_BEAT;

// 格子の m_c を色にした下敷き。シーンに入るたびに作り直さないよう、1つを使い回す
const heatPixels = new Uint8Array(NX * NY * 4);
const heatTexture = new DataTexture(heatPixels, NX, NY, RGBAFormat);
heatTexture.magFilter = LinearFilter;
heatTexture.minFilter = LinearFilter;
heatTexture.colorSpace = SRGBColorSpace;
const HEAT_UP = new Color(0x163a6e);
const HEAT_FLAT = new Color(0x9fd0ff);
const HEAT_DOWN = new Color(PALETTE.warm);

export const spins = defineScene('spins', () => {
  const fader = new Fader();
  const root = new Group();

  const field = new SpinField(NX, NY, PARAMS, 5, PITCH, CENTER, fader);
  const lattice = field.lattice;
  root.add(field.mesh);

  const heatMaterial = fader.add(new MeshBasicMaterial({ map: heatTexture, opacity: 0, depthWrite: false }));
  const heat = new Mesh(new PlaneGeometry(W, D), heatMaterial);
  heat.rotation.x = -Math.PI / 2;
  heat.position.set(CENTER.x, 0.0004, CENTER.z);
  root.add(heat);

  // 格子の枠と、5サイトごとの目盛り
  const half = { x: W / 2 + 0.004, z: D / 2 + 0.004 };
  const at = (x: number, z: number): Vector3 => new Vector3(CENTER.x + x, Y_INK, CENTER.z + z);
  const frame = new LineBuilder().polyline([at(-half.x, -half.z), at(half.x, -half.z), at(half.x, half.z), at(-half.x, half.z)], true);
  for (let i = 0; i <= NX; i += 5) {
    const x = (i - (NX - 1) / 2) * PITCH;
    frame.segment(at(x, half.z), at(x, half.z + 0.004)).segment(at(x, -half.z), at(x, -half.z - 0.004));
  }
  for (let i = 0; i <= NY; i += 5) {
    const z = -(i - (NY - 1) / 2) * PITCH;
    frame.segment(at(-half.x, z), at(-half.x - 0.004, z)).segment(at(half.x, z), at(half.x + 0.004, z));
  }
  const frameMaterial = fader.line(PALETTE.ink, 0.75);
  const frameLines = frame.build(frameMaterial);
  root.add(frameLines);
  const frameVertices = frameLines.geometry.getAttribute('position').count;
  root.add(floorLabel(fader, `${NX} x ${NY} sites   a = 10 mm   J = 1   D = ${PARAMS.d}`, CENTER.x - half.x, CENTER.z - half.z - 0.006, { anchorX: 'left', size: 0.0046 }, 0.8));

  // 急冷の瞬間に広がる輪と、小節ごとに格子を横切る光の線
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const shockMaterial = fader.line(PALETTE.glow, 0);
  const shock = new LineBuilder().circle(new Vector3(0, 0.002, 0), 1, X, Z, 96).build(shockMaterial);
  shock.position.copy(CENTER);
  root.add(shock);
  const sweepMaterial = fader.line(PALETTE.cyan, 0);
  const sweep = new LineBuilder().segment(new Vector3(0, 0.012, -D / 2), new Vector3(0, 0.012, D / 2)).build(sweepMaterial);
  sweep.position.copy(CENTER);
  root.add(sweep);

  // スキルミオンの芯の印(半径 1 の二重の輪を、芯の大きさに合わせて拡大する)
  const ringMaterial = fader.line(PALETTE.glow, 0);
  const rings = Array.from({ length: MAX_RINGS }, () => {
    const ring = new LineBuilder().circle(new Vector3(), 1, X, Z, 32).circle(new Vector3(), 1.18, X, Z, 32).build(ringMaterial);
    ring.visible = false;
    root.add(ring);
    return ring;
  });

  // 奥のパネル: −Q(t) と B(t)
  const panel = scopePanel(fader, {
    x0: -0.17,
    x1: 0.17,
    y0: 0.024,
    y1: 0.08,
    z: -0.142,
    cols: 8,
    rows: 4,
    title: 'Q(t), B(t)    E = -J sum m_i.m_j - D sum d_ij.(m_i x m_j) - B sum m_z',
  });
  root.add(panel.group);
  const qTrace = new DynamicLine(MAX_SAMPLES, fader.line(PALETTE.warm, 1));
  const bTrace = new DynamicLine(MAX_SAMPLES, fader.line(PALETTE.cyan, 0.9));
  const cursor = new DynamicLine(2, fader.line(PALETTE.glow, 0.35));
  root.add(qTrace.line, bTrace.line, cursor.line);
  const qLegend = standLabel(fader, '-Q', 0.174, 0, -0.142, { anchorX: 'left', size: 0.0052, color: PALETTE.warm });
  const bLegend = standLabel(fader, 'B', 0.174, 0, -0.142, { anchorX: 'left', size: 0.0052, color: PALETTE.cyan });
  root.add(qLegend, bLegend);

  // 左下の計器(右下の表題欄と対になる位置)
  const gauge = { x0: -0.194, x1: -0.07, z0: 0.108, z1: 0.144 };
  root.add(
    new LineBuilder()
      .polyline([new Vector3(gauge.x0, Y_INK, gauge.z0), new Vector3(gauge.x1, Y_INK, gauge.z0), new Vector3(gauge.x1, Y_INK, gauge.z1), new Vector3(gauge.x0, Y_INK, gauge.z1)], true)
      .segment(new Vector3(gauge.x0, Y_INK, (gauge.z0 + gauge.z1) / 2), new Vector3(gauge.x1, Y_INK, (gauge.z0 + gauge.z1) / 2))
      .build(fader.line(PALETTE.gridMajor, 0.42)),
  );
  const readout = (x: number, z: number, color: number = PALETTE.label): Text => {
    const label = floorLabel(fader, '', x, z, { anchorX: 'left', size: 0.005, color });
    root.add(label);
    return label;
  };
  const rB = readout(gauge.x0 + 0.006, 0.1175, PALETTE.cyan);
  const rQ = readout(gauge.x0 + 0.064, 0.1175, PALETTE.warm);
  const rE = readout(gauge.x0 + 0.006, 0.1345);
  const rT = readout(gauge.x0 + 0.064, 0.1345, PALETTE.glow);

  root.add(titleBlock(fader, 5, 'SPIN LATTICE', 'BLOCH DMI, QUENCH B 0.45 -> 1.2'));

  // 緩和の進み方と、Q の記録(巻き戻されたら最初から計算し直す)
  const history = { q: new Float32Array(MAX_SAMPLES), b: new Float32Array(MAX_SAMPLES), count: 0 };
  const advance = (beat: number): void => {
    const target = Math.max(0, Math.floor((beat - QUENCH) * SPIN_STEPS_PER_BEAT));
    if (target < lattice.steps) {
      lattice.reset();
      history.count = 0;
    }
    while (lattice.steps < target) {
      const s = lattice.steps;
      lattice.step(fieldAt(QUENCH + s / SPIN_STEPS_PER_BEAT));
      if ((s + 1) % SAMPLE_STEPS === 0 && history.count < MAX_SAMPLES) {
        history.q[history.count] = lattice.topologicalCharge();
        history.b[history.count] = fieldAt(QUENCH + (s + 1) / SPIN_STEPS_PER_BEAT);
        history.count += 1;
      }
    }
  };

  const tmp = new Vector3();
  const color = new Color();

  return {
    root,
    fader,
    update(beat, ctx) {
      advance(beat);
      const running = beat >= QUENCH;

      // ---- 枠と格子 ----
      const drawn = easeOutCubic(progress(beat, FRAME_DRAW));
      frameLines.geometry.setDrawRange(0, Math.floor((drawn * frameVertices) / 2) * 2);
      const reveal = progress(beat, REVEAL) * Math.hypot(NX, NY) * 0.5 + 0.6;
      // 急冷までは「熱い」状態として揺らす。急冷の瞬間に静まる
      field.draw(beat < REVEAL[0] ? 0 : reveal, running ? 0 : 0.55, beat);

      for (let i = 0; i < NX * NY; i++) {
        const c = lattice.m[i * 3 + 2] ?? 1;
        color.copy(HEAT_FLAT).lerp(c >= 0 ? HEAT_UP : HEAT_DOWN, Math.abs(c));
        heatPixels[i * 4] = Math.round(color.r * 255);
        heatPixels[i * 4 + 1] = Math.round(color.g * 255);
        heatPixels[i * 4 + 2] = Math.round(color.b * 255);
        heatPixels[i * 4 + 3] = 255;
      }
      heatTexture.needsUpdate = true;
      const pulse = beatPulse(ctx, 0.4);
      fader.set(heatMaterial, running ? 0.42 + 0.08 * (ctx.beat.beat === 1 ? pulse : 0) : 0.18 * progress(beat, REVEAL));

      // 秒読みの間は、拍ごとに枠が光る
      const counting = beat >= QUENCH - COUNTDOWN && !running;
      frameMaterial.color.set(counting && ctx.beat.phase < 0.3 ? PALETTE.warm : PALETTE.ink);
      fader.set(frameMaterial, 0.75 + (counting ? 0.25 * pulse : 0));

      // ---- 急冷の輪、小節ごとの光の線 ----
      const sinceQuench = beat - QUENCH;
      shock.scale.setScalar(0.005 + Math.max(sinceQuench, 0) * 0.22);
      fader.set(shockMaterial, running ? Math.max(0, 0.9 * (1 - sinceQuench / 1.2)) : 0);
      const inBar = running ? sinceQuench % 4 : 4;
      sweep.position.x = CENTER.x - W / 2 + W * easeOutCubic(clamp01(inBar));
      fader.set(sweepMaterial, inBar < 1 ? 0.55 * (1 - inBar) : 0);

      // ---- スキルミオンの芯 ----
      const marking = smoothstep(progress(beat, [MARK_FROM, MARK_FROM + 1]));
      let rCount = 0;
      if (marking > 0) {
        for (const core of findDomains(lattice.m, lattice.nx, lattice.ny, CORE_THRESHOLD)) {
          if (core.size > CORE_MAX_SIZE) continue;
          const ring = rings[rCount];
          if (ring === undefined) break;
          field.sitePosition(core.x, core.y, ring.position).setY(0.013);
          ring.scale.setScalar(PITCH * (1.1 + 0.4 * Math.sqrt(core.size)));
          ring.visible = true;
          rCount += 1;
        }
      }
      for (let k = rCount; k < MAX_RINGS; k++) {
        const ring = rings[k];
        if (ring !== undefined) ring.visible = false;
      }
      fader.set(ringMaterial, marking * (0.65 + 0.35 * pulse));

      // ---- パネル ----
      const n = history.count;
      for (let k = 0; k < n; k++) {
        const u = plotU(sampleBeat(k));
        panel.at(u, clamp01(-(history.q[k] ?? 0) / Q_SCALE), tmp);
        qTrace.set(k, tmp.x, tmp.y, tmp.z);
        panel.at(u, clamp01((history.b[k] ?? 0) / B_SCALE), tmp);
        bTrace.set(k, tmp.x, tmp.y, tmp.z);
      }
      qTrace.commit(n);
      bTrace.commit(n);
      const lastQ = n > 0 ? (history.q[n - 1] ?? 0) : 0;
      const lastB = running ? fieldAt(beat) : 0;
      qLegend.position.y = panel.at(1, clamp01(-lastQ / Q_SCALE), tmp).y;
      bLegend.position.y = panel.at(1, clamp01(lastB / B_SCALE), tmp).y;
      qLegend.visible = n > 0;
      bLegend.visible = n > 0;
      panel.at(plotU(beat), 0, tmp);
      cursor.set(0, tmp.x, tmp.y, tmp.z);
      panel.at(plotU(beat), 1, tmp);
      cursor.set(1, tmp.x, tmp.y, tmp.z);
      cursor.commit(running ? 2 : 0);

      // ---- 計器 ----
      if (running) {
        setText(rB, `B   = ${lastB.toFixed(2)}`);
        setText(rQ, `Q = ${lastQ.toFixed(1)}`);
        setText(rE, `E/N = ${lattice.energy(lastB).toFixed(3)}`);
        setText(rT, marking > 0 ? `N_sk = ${rCount}` : `t = ${String(lattice.steps).padStart(4, '0')} dt`);
      } else {
        setText(rB, 'B   = --');
        setText(rQ, 'Q = --');
        setText(rE, 'T   = inf (random)');
        setText(rT, counting ? `quench in ${Math.max(1, Math.ceil(QUENCH - beat))}` : 'ready');
      }
    },
  };
});
