import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
  type LineSegments,
} from 'three';
import type { Text } from 'troika-three-text';
import type { BeatGrid } from '../core/beats';
import { arcPoints, LineBuilder } from '../gfx/lines';
import { inputVoltage, RectifierSim, unsmoothedOutput, type RectifierParams } from '../sim/bridgeRectifier';
import {
  DynamicLine,
  Fader,
  PALETTE,
  STAGE,
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
  type SceneView,
} from './kit';
import type { SceneContext } from './types';

/**
 * #10 AC から DC へ: ブループリントの床の上に、ブリッジ全波整流回路をワイヤーフレームで立ち上げる。
 * 回路を流れる電流を粒で見せる。交流側の粒は半周期ごとに向きが変わり、ブリッジを抜けた直流側の粒はいつも同じ向きに流れる。
 * IN 側のパネルに正弦波、OUT 側のパネルに整流後の波形を出し、2小節目の頭でスイッチが閉じてコンデンサが入り、直流に均される。
 * コンデンサが入ると、電流はピークのときだけブリッジを流れ、それ以外はコンデンサが放電して負荷を支える(粒が逆に流れる)。
 * 2小節(8拍)を想定。
 */

// ---- 定数(後で歌に合わせて調整する) ----

/** 回路定数(周波数は BEATS_PER_CYCLE から決める) */
const CIRCUIT: Omit<RectifierParams, 'freqHz'> = { vPeak: 10, vf: 0.7, r: 1000, rs: 15, c: 0.006 };
/** 入力の正弦波 1 周期の拍数。130 BPM で約 1.083Hz(目で追える見た目用の値) */
const BEATS_PER_CYCLE = 2;

/** シーン内の時刻 [拍](シーン開始が 0。2小節 = 8拍を想定。歌詞は前半から言葉が詰まっている) */
const TIMING = {
  floorIn: [0, 0.75],
  draw: [0, 1.75],
  rise: [0.5, 2.5],
  panels: [1, 2],
  labels: [1.25, 2.25],
  /** 電流の粒が見え始める区間 */
  flow: [1.25, 2.25],
  /** コンデンサのスイッチが閉じる時刻(2小節目の頭) */
  capacitorOn: 4,
  /** スイッチのレバーが倒れるのにかける時間 */
  switchMotion: 0.5,
  /** 部品1つが床から立ち上がるのにかける時間 */
  bodyRise: 0.75,
  /** コンデンサが入ったあと、元の脈流(ゴースト)が現れるのにかける時間 */
  ghostIn: 1,
} as const;

const TRACE_SAMPLES = 240;
/** 波形パネルに表示する時間幅 [周期] */
const TRACE_CYCLES = 2;
/** 波形の1サンプルあたりの積分の刻み数 */
const STEPS_PER_SAMPLE = 8;

/** 電流の粒の間隔 [m] と、基準電流のときの流れる速さ [m/s] */
const PARTICLE = { spacing: 0.011, speed: 0.07, capacity: 220 } as const;

const COLOR = {
  floor: PALETTE.floor,
  gridMinor: PALETTE.gridMinor,
  gridMajor: PALETTE.gridMajor,
  ink: PALETTE.ink,
  body: 0x6f9fd6,
  bodyIdle: PALETTE.idle,
  glow: PALETTE.glow,
  traceIn: PALETTE.cyan,
  traceOut: 0xffffff,
  ghost: PALETTE.dim,
  label: PALETTE.label,
  charge: PALETTE.warm,
} as const;

// ---- レイアウト(ステージ座標 [m]。+X 右、+Z 手前、+Y 上) ----

/** 床に描く線の高さ(床面との z-fighting を避ける) */
const Y_INK = 0.0008;
/** 回路の中心の Z(奥に波形パネルを置くので少し手前に寄せる) */
const Z0 = 0.02;
const at = (x: number, z: number, y = Y_INK): Vector3 => new Vector3(x, y, z);

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

const SOURCE = { center: at(-0.15, Z0), radius: 0.014 };
const NODE = {
  /** 交流側(上) */
  top: at(-0.06, Z0 - 0.045),
  /** 交流側(下) */
  bottom: at(-0.06, Z0 + 0.045),
  /** 直流 − */
  minus: at(-0.105, Z0),
  /** 直流 + */
  plus: at(-0.015, Z0),
} as const;
const RAIL = { plusZ: Z0 - 0.045, minusZ: Z0 + 0.068, endX: 0.165, startX: 0.005 } as const;
const X_CAP = 0.045;
const X_RES = 0.12;
const SWITCH = { hinge: at(X_CAP, RAIL.plusZ + 0.008), length: 0.016, openAngle: (35 * Math.PI) / 180 } as const;
const CAP_PLATES_Z = [Z0 + 0.012, Z0 + 0.018] as const;
const RES_SPAN = [Z0 - 0.006, Z0 + 0.026] as const;

const PANEL = { z: -0.11, base: 0.008, height: 0.075 } as const;

interface DiodeSpec {
  readonly name: string;
  readonly anode: Vector3;
  readonly cathode: Vector3;
  /** vIn > 0(上側が高電位)の半周期で導通するか */
  readonly positiveHalf: boolean;
}

/** 正の半周期: 上 → D1 → + → 負荷 → − → D3 → 下。負の半周期: 下 → D2 → + → 負荷 → − → D4 → 上 */
const DIODES: readonly DiodeSpec[] = [
  { name: 'D1', anode: NODE.top, cathode: NODE.plus, positiveHalf: true },
  { name: 'D2', anode: NODE.bottom, cathode: NODE.plus, positiveHalf: false },
  { name: 'D3', anode: NODE.minus, cathode: NODE.bottom, positiveHalf: true },
  { name: 'D4', anode: NODE.minus, cathode: NODE.top, positiveHalf: false },
];

/** 電流の通り道(粒を流す折れ線)。床の配線の少し上に浮かせる */
const FLOW_Y = Y_INK * 3;
const flowPoint = (p: Vector3): Vector3 => p.clone().setY(FLOW_Y);
const SRC_TOP = at(SOURCE.center.x, SOURCE.center.z - SOURCE.radius);
const SRC_BOTTOM = at(SOURCE.center.x, SOURCE.center.z + SOURCE.radius);
const PATHS = {
  /** 正の半周期: 電源の上 → D1 → +、− → D3 → 電源の下 */
  positive: [
    [SRC_TOP, at(SOURCE.center.x, NODE.top.z), NODE.top, NODE.plus],
    [NODE.minus, NODE.bottom, at(SOURCE.center.x, NODE.bottom.z), SRC_BOTTOM],
  ],
  /** 負の半周期: 電源の下 → D2 → +、− → D4 → 電源の上 */
  negative: [
    [SRC_BOTTOM, at(SOURCE.center.x, NODE.bottom.z), NODE.bottom, NODE.plus],
    [NODE.minus, NODE.top, at(SOURCE.center.x, NODE.top.z), SRC_TOP],
  ],
  /** 直流側: + → 上のレール → 負荷 → 下のレール → −(どちらの半周期でも同じ向き) */
  load: [[NODE.plus, at(RAIL.startX, NODE.plus.z), at(RAIL.startX, RAIL.plusZ), at(X_RES, RAIL.plusZ), at(X_RES, RAIL.minusZ), at(NODE.minus.x, RAIL.minusZ), NODE.minus]],
  /** コンデンサの枝: 上のレール → 極板、極板 → 下のレール(充電の向きを正とする) */
  capacitor: [
    [at(X_CAP, RAIL.plusZ), at(X_CAP, CAP_PLATES_Z[0])],
    [at(X_CAP, CAP_PLATES_Z[1]), at(X_CAP, RAIL.minusZ)],
  ],
} as const;

/** 折れ線と、その全長 */
interface Path {
  readonly points: readonly Vector3[];
  readonly lengths: readonly number[];
  readonly total: number;
}

function makePath(points: readonly Vector3[]): Path {
  const flow = points.map(flowPoint);
  const lengths = [0];
  for (let i = 1; i < flow.length; i++) lengths.push((lengths[i - 1] ?? 0) + (flow[i]?.distanceTo(flow[i - 1] ?? new Vector3()) ?? 0));
  return { points: flow, lengths, total: lengths[lengths.length - 1] ?? 0 };
}

/** 折れ線の始点から距離 s の点 */
function pointAt(path: Path, s: number, out: Vector3): Vector3 {
  const { points, lengths } = path;
  for (let i = 1; i < points.length; i++) {
    const l1 = lengths[i] ?? 0;
    if (s <= l1 || i === points.length - 1) {
      const l0 = lengths[i - 1] ?? 0;
      const k = l1 > l0 ? clamp01((s - l0) / (l1 - l0)) : 0;
      return out.lerpVectors(points[i - 1] ?? out, points[i] ?? out, k);
    }
  }
  return out.copy(points[0] ?? out);
}

// ---- 補助 ----

/** 床に描いた線と、そこから立ち上がる立体を対にして持つ */
interface Body {
  readonly group: Group;
  readonly material: LineBasicMaterial;
  /** 立ち上がりを始める時刻 [拍](左から右へ順に立ち上げる) */
  readonly riseAt: number;
}

interface Panel {
  readonly group: Group;
  readonly width: number;
  readonly height: number;
  readonly trace: DynamicLine;
  readonly title: Text;
  readonly frame: LineBasicMaterial;
}

/** 立ち上げの順番を X 位置から決める [拍] */
function riseStart(x: number): number {
  const [from, to] = TIMING.rise;
  const span = to - from - TIMING.bodyRise;
  return from + clamp01((x + STAGE.width / 2) / STAGE.width) * span;
}

class RectifierView implements SceneView {
  readonly root = new Group();
  readonly fader = new Fader();
  private readonly params: RectifierParams;
  /** 1拍の長さ [s] */
  private readonly secondsPerBeat: number;
  /** 積分の刻み [s]。波形パネルにちょうど TRACE_CYCLES 周期が収まるように決める */
  private readonly simStep: number;
  private readonly sim: RectifierSim;
  /** ダイオードの発光を正規化する基準電流(コンデンサ無しのときの最大電流) */
  private readonly iRef: number;

  /** 直近の出力電圧(新しい順に並べるためのリングバッファ) */
  private readonly outRing = new Float32Array(TRACE_SAMPLES);
  private ringHead = 0;
  private ringCount = 0;
  /** 流れた電荷の積算 [C](粒の位置に使う)。ブリッジ、負荷、コンデンサ(充電を正) */
  private chargeBridge = 0;
  private chargeLoad = 0;
  private chargeCap = 0;

  private readonly floorMaterials: { readonly material: MeshBasicMaterial | LineBasicMaterial; readonly opacity: number }[] = [];
  private readonly ink: LineSegments;
  private readonly inkMaterial: LineBasicMaterial;
  private readonly bodies: Body[] = [];
  private readonly diodes: { readonly spec: DiodeSpec; readonly body: Body }[] = [];
  private readonly capacitor: Body;
  private readonly resistor: Body;
  private readonly source: Body;
  /** コンデンサの中で、電圧に応じて上下する輪(充電の量) */
  private readonly chargeRing: Group;
  private readonly chargeRingMaterial: LineBasicMaterial;
  private readonly switchLever = new Group();
  private readonly switchMaterial: LineBasicMaterial;
  private readonly labels: Text[] = [];
  private readonly inPanel: Panel;
  private readonly outPanel: Panel;
  private readonly ghost: DynamicLine;
  private readonly ghostMaterial: LineBasicMaterial;
  private readonly railFlash: LineBasicMaterial;
  private readonly readout: Text;
  private outTitleSmoothing = false;

  private readonly paths = {
    positive: PATHS.positive.map(makePath),
    negative: PATHS.negative.map(makePath),
    load: PATHS.load.map(makePath),
    capacitor: PATHS.capacitor.map(makePath),
  };
  private readonly flowPositions: BufferAttribute;
  private readonly flowGeometry = new BufferGeometry();
  private readonly flowMaterial: PointsMaterial;
  private readonly capPositions: BufferAttribute;
  private readonly capGeometry = new BufferGeometry();
  private readonly capMaterial: PointsMaterial;

  private readonly tmpColor = new Color();
  private readonly baseColor = new Color();
  private readonly glowColor = new Color(COLOR.glow);
  private readonly tmp = new Vector3();

  constructor(beats: BeatGrid) {
    this.secondsPerBeat = beats.secondsPerBeat;
    this.params = { ...CIRCUIT, freqHz: 1 / (BEATS_PER_CYCLE * this.secondsPerBeat) };
    this.simStep = TRACE_CYCLES / this.params.freqHz / (TRACE_SAMPLES * STEPS_PER_SAMPLE);
    this.sim = new RectifierSim(this.params, this.simStep);
    this.iRef = this.params.vPeak / (this.params.r + this.params.rs);

    this.root.name = 'rectifier';
    this.buildFloor();
    this.inkMaterial = this.fader.line(COLOR.ink, 0.9);
    this.ink = this.buildSchematic();
    this.switchMaterial = this.fader.line(COLOR.glow, 0.95);
    this.buildSwitchLever();
    this.source = this.buildSource();
    for (const spec of DIODES) {
      this.diodes.push({ spec, body: this.buildDiode(spec) });
    }
    this.capacitor = this.buildCapacitor();
    this.chargeRingMaterial = this.fader.line(COLOR.charge, 0);
    this.chargeRing = this.buildChargeRing();
    this.resistor = this.buildResistor();
    this.railFlash = this.buildRailFlash();
    this.buildLabels();
    this.readout = floorLabel(this.fader, '', RAIL.endX + 0.002, (RAIL.plusZ + RAIL.minusZ) / 2 + 0.012, { size: 0.0058, color: COLOR.glow }, 0);
    this.root.add(this.readout);

    this.inPanel = this.buildPanel('in', -0.1, 0.17, 'IN   v = Vp*sin(2*pi*f*t)');
    this.outPanel = this.buildPanel('out', 0.09, 0.18, 'OUT  v = |v_in| - 2*Vf');
    this.ghostMaterial = this.fader.line(COLOR.ghost, 0);
    this.ghost = new DynamicLine(TRACE_SAMPLES, this.ghostMaterial);
    // 均された波形の少し奥に出す
    this.ghost.line.position.z = 0.0003;
    this.outPanel.group.add(this.ghost.line);

    this.flowPositions = new BufferAttribute(new Float32Array(PARTICLE.capacity * 3), 3);
    this.flowPositions.setUsage(DynamicDrawUsage);
    this.flowGeometry.setAttribute('position', this.flowPositions);
    this.flowMaterial = this.fader.add(new PointsMaterial({ color: COLOR.glow, size: 0.0032, depthWrite: false, opacity: 0 }));
    const flow = new Points(this.flowGeometry, this.flowMaterial);
    flow.frustumCulled = false;
    this.root.add(flow);
    this.capPositions = new BufferAttribute(new Float32Array(32 * 3), 3);
    this.capPositions.setUsage(DynamicDrawUsage);
    this.capGeometry.setAttribute('position', this.capPositions);
    this.capMaterial = this.fader.add(new PointsMaterial({ color: COLOR.charge, size: 0.0034, depthWrite: false, opacity: 0 }));
    const capFlow = new Points(this.capGeometry, this.capMaterial);
    capFlow.frustumCulled = false;
    this.root.add(capFlow);

    this.root.add(titleBlock(this.fader, 10, 'AC -> DC', 'FULL-WAVE BRIDGE RECTIFIER'));
  }

  update(beat: number, ctx: SceneContext): void {
    this.advanceSim(beat * this.secondsPerBeat);
    this.animateBuild(beat);
    this.animateCircuit(beat, ctx);
    this.updateTraces();
    this.updateFlow(beat);
  }

  // ---- 時間発展 ----

  /** @param t 経過秒(回路の計算は秒で行う) */
  private advanceSim(t: number): void {
    if (t < this.sim.time) {
      // 巻き戻されたら最初から計算し直す(状態を持つ回路なので、途中からは再開できない)
      this.sim.reset();
      this.ringHead = 0;
      this.ringCount = 0;
      this.chargeBridge = 0;
      this.chargeLoad = 0;
      this.chargeCap = 0;
    }
    const capacitorOn = TIMING.capacitorOn * this.secondsPerBeat;
    const h = this.simStep;
    while (this.sim.time + h <= t) {
      const sample = this.sim.advance(this.sim.time >= capacitorOn);
      const iLoad = sample.vOut / this.params.r;
      this.chargeBridge += this.visual(sample.iBridge) * h;
      this.chargeLoad += this.visual(iLoad) * h;
      // コンデンサに流れ込む電流 = ブリッジから来る電流 − 負荷へ出ていく電流(放電中は負)
      this.chargeCap += this.visual(sample.iBridge - iLoad) * h;
      if (this.sim.steps % STEPS_PER_SAMPLE === 0) {
        this.ringHead = (this.ringHead + 1) % TRACE_SAMPLES;
        this.outRing[this.ringHead] = sample.vOut;
        this.ringCount = Math.min(this.ringCount + 1, TRACE_SAMPLES);
      }
    }
  }

  /**
   * 粒の速さに使う電流。コンデンサが入るとピークで基準の数倍の電流が流れ、粒が速すぎて逆向きに見える(フレームとの折り返し)ので、
   * 大きい電流は頭打ちにする(向きと、小さい電流の比例はそのまま)
   */
  private visual(current: number): number {
    const cap = this.iRef * 1.6;
    return cap * Math.tanh(current / cap);
  }

  /** @param t 経過拍数 */
  private animateBuild(t: number): void {
    const floor = smoothstep(progress(t, TIMING.floorIn));
    for (const { material, opacity } of this.floorMaterials) {
      this.fader.set(material, opacity * floor);
    }

    const draw = progress(t, TIMING.draw);
    const count = this.ink.geometry.getAttribute('position').count;
    this.ink.geometry.setDrawRange(0, Math.floor((draw * count) / 2) * 2);
    // レバーはコンデンサの枝が描かれてから出す
    this.switchLever.visible = draw > 0.85;

    for (const body of this.bodies) {
      const k = easeOutCubic(clamp01((t - body.riseAt) / TIMING.bodyRise));
      body.group.scale.y = Math.max(k, 1e-4);
      body.group.visible = k > 0;
    }

    const panels = easeOutCubic(progress(t, TIMING.panels));
    for (const panel of [this.inPanel, this.outPanel]) {
      panel.group.scale.y = Math.max(panels, 1e-4);
      panel.group.visible = panels > 0;
    }

    const labels = progress(t, TIMING.labels);
    for (const label of this.labels) {
      this.fader.set(label, labels);
    }
  }

  /** @param t 経過拍数 */
  private animateCircuit(t: number, ctx: SceneContext): void {
    const s = this.sim.latest;
    const current = clamp01(s.iBridge / this.iRef) ** 0.6;
    for (const { spec, body } of this.diodes) {
      const conducting = s.iBridge > 0 && spec.positiveHalf === s.vIn >= 0;
      this.setGlow(body, COLOR.body, conducting ? current : 0);
    }
    this.setGlow(this.source, COLOR.body, (Math.abs(s.vIn) / this.params.vPeak) * 0.6);
    this.setGlow(this.resistor, COLOR.body, (s.vOut / this.params.vPeak) * 0.8);

    // スイッチ: capacitorOn の時刻にちょうど接点が閉じるように、その少し前から倒し始める
    const closing = smoothstep(clamp01((t - (TIMING.capacitorOn - TIMING.switchMotion)) / TIMING.switchMotion));
    this.switchLever.rotation.y = SWITCH.openAngle * (1 - closing);
    const connected = t >= TIMING.capacitorOn;
    this.setGlow(this.capacitor, connected ? COLOR.body : COLOR.bodyIdle, connected ? current * 0.8 : 0);
    this.switchMaterial.color.set(connected ? COLOR.charge : COLOR.glow);

    // コンデンサの中の輪: 端子電圧に応じた高さ(充電の量)
    const level = connected ? clamp01(s.vOut / this.params.vPeak) : 0;
    this.chargeRing.position.y = 0.002 + level * 0.02;
    this.fader.set(this.chargeRingMaterial, connected ? 0.9 : 0);

    // 接続の瞬間に直流側の配線を光らせる(2小節目の頭のアクセント)
    const sinceConnect = t - TIMING.capacitorOn;
    this.fader.set(this.railFlash, sinceConnect >= 0 ? 0.9 * Math.exp(-sinceConnect / 0.6) : 0);

    // 拍ごとに波形パネルの枠を少し明るくする
    const pulse = beatPulse(ctx, 0.3) * progress(t, TIMING.panels);
    for (const panel of [this.inPanel, this.outPanel]) this.fader.set(panel.frame, 0.55 + 0.35 * pulse);

    // コンデンサ無しの波形をゴーストとして残し、均された波形と比べられるようにする
    this.fader.set(this.ghostMaterial, 0.7 * smoothstep(clamp01((t - TIMING.capacitorOn) / TIMING.ghostIn)));
    if (connected !== this.outTitleSmoothing) {
      this.outTitleSmoothing = connected;
      setText(this.outPanel.title, connected ? 'OUT  C*dv/dt = (v_r - v)/Rs - v/R' : 'OUT  v = |v_in| - 2*Vf');
    }

    // 出力電圧と、コンデンサが入ってからはリプル(直近1周期の最大 − 最小)
    let min = Infinity;
    let max = -Infinity;
    const perCycle = Math.min(this.ringCount, Math.round(TRACE_SAMPLES / TRACE_CYCLES));
    for (let k = 0; k < perCycle; k++) {
      const v = this.outRing[(this.ringHead - k + TRACE_SAMPLES) % TRACE_SAMPLES] ?? 0;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const ripple = perCycle > 0 ? max - min : 0;
    this.fader.set(this.readout, progress(t, TIMING.labels));
    setText(this.readout, t >= TIMING.capacitorOn + BEATS_PER_CYCLE ? `${s.vOut.toFixed(1)} V  ripple ${ripple.toFixed(1)} V` : `${s.vOut.toFixed(1)} V`);
  }

  private setGlow(body: Body, base: number, amount: number): void {
    this.baseColor.set(base);
    body.material.color.copy(this.tmpColor.lerpColors(this.baseColor, this.glowColor, clamp01(amount)));
  }

  /** 波形パネルの更新。左端が最新で、時間が経つと右へ流れていく(IN から OUT へ左→右に流れる向き) */
  private updateTraces(): void {
    const p = this.params;
    const newest = this.sim.time - (this.sim.steps % STEPS_PER_SAMPLE) * this.simStep;
    const dtSample = STEPS_PER_SAMPLE * this.simStep;
    const count = this.ringCount;
    const { width: wIn, height: hIn } = this.inPanel;
    const { width: wOut, height: hOut } = this.outPanel;

    for (let k = 0; k < count; k++) {
      const u = k / (TRACE_SAMPLES - 1);
      const tk = newest - k * dtSample;
      const vIn = inputVoltage(p, tk);
      const vOut = this.outRing[(this.ringHead - k + TRACE_SAMPLES) % TRACE_SAMPLES] ?? 0;
      this.inPanel.trace.set(k, -wIn / 2 + u * wIn, hIn / 2 + (vIn / p.vPeak) * hIn * 0.4, 0);
      this.outPanel.trace.set(k, -wOut / 2 + u * wOut, outBaseline(hOut) + (vOut / p.vPeak) * hOut * 0.78, 0);
      this.ghost.set(k, -wOut / 2 + u * wOut, outBaseline(hOut) + (unsmoothedOutput(p, vIn) / p.vPeak) * hOut * 0.78, 0);
    }
    this.inPanel.trace.commit(count);
    this.outPanel.trace.commit(count);
    this.ghost.commit(count);
  }

  /** 電流の粒。流れた電荷の量だけ折れ線に沿って進める */
  private updateFlow(t: number): void {
    const s = this.sim.latest;
    const scale = PARTICLE.speed / this.iRef;
    let n = 0;
    const place = (paths: readonly Path[], charge: number, out: BufferAttribute, max: number): void => {
      const offset = (((charge * scale) % PARTICLE.spacing) + PARTICLE.spacing) % PARTICLE.spacing;
      for (const path of paths) {
        for (let d = offset; d < path.total && n < max; d += PARTICLE.spacing) {
          pointAt(path, d, this.tmp);
          out.setXYZ(n++, this.tmp.x, this.tmp.y, this.tmp.z);
        }
      }
    };

    // ブリッジを流れていないときは交流側の粒を出さない(コンデンサが入るとピークのときだけ流れる)
    if (s.iBridge > 1e-6) {
      place(s.vIn >= 0 ? this.paths.positive : this.paths.negative, this.chargeBridge, this.flowPositions, PARTICLE.capacity);
    }
    place(this.paths.load, this.chargeLoad, this.flowPositions, PARTICLE.capacity);
    this.flowGeometry.setDrawRange(0, n);
    this.flowPositions.needsUpdate = true;
    this.fader.set(this.flowMaterial, 0.95 * progress(t, TIMING.flow));

    const connected = t >= TIMING.capacitorOn;
    n = 0;
    if (connected) place(this.paths.capacitor, this.chargeCap, this.capPositions, 32);
    this.capGeometry.setDrawRange(0, n);
    this.capPositions.needsUpdate = true;
    this.fader.set(this.capMaterial, connected ? 0.95 : 0);
  }

  // ---- 構築 ----

  private addFloor<T extends MeshBasicMaterial | LineBasicMaterial>(material: T): T {
    this.floorMaterials.push({ material, opacity: material.opacity });
    this.fader.add(material);
    this.fader.set(material, 0);
    return material;
  }

  /**
   * このシーンだけの床: 薄い青の面と 1cm のグリッド。
   * 外枠と 5cm のグリッドは共通の StageBase が出すので、5cm ごとの線は描かない
   */
  private buildFloor(): void {
    const { width: w, depth: d } = STAGE;
    const plane = new Mesh(
      new PlaneGeometry(w, d),
      this.addFloor(new MeshBasicMaterial({ color: COLOR.floor, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide })),
    );
    plane.rotation.x = -Math.PI / 2;
    this.root.add(plane);

    const minor = new LineBuilder();
    const y = Y_INK / 2;
    for (let i = 1; i < Math.round(w / 0.01); i++) {
      if (i % 5 === 0) continue;
      const x = -w / 2 + i * 0.01;
      minor.segment(new Vector3(x, y, -d / 2), new Vector3(x, y, d / 2));
    }
    for (let i = 1; i < Math.round(d / 0.01); i++) {
      if (i % 5 === 0) continue;
      const z = -d / 2 + i * 0.01;
      minor.segment(new Vector3(-w / 2, y, z), new Vector3(w / 2, y, z));
    }
    this.root.add(minor.build(this.addFloor(new LineBasicMaterial({ color: COLOR.gridMinor, transparent: true, opacity: 0.16, depthWrite: false }))));
  }

  /** 床に描く回路図。信号の流れ(電源 → ブリッジ → 負荷)の順に線を積むので、その順に描かれていく */
  private buildSchematic(): LineSegments {
    const ink = new LineBuilder();
    const { center: c, radius: r } = SOURCE;

    // 交流電源の記号(円の中に正弦波)
    ink.circle(c, r, X_AXIS, Z_AXIS, 32);
    const sine: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      sine.push(at(c.x - r * 0.65 + u * r * 1.3, c.z - Math.sin(u * Math.PI * 2) * r * 0.35));
    }
    ink.polyline(sine);

    // 電源 → ブリッジの交流側
    ink.polyline([at(c.x, c.z - r), at(c.x, NODE.top.z), NODE.top]);
    ink.polyline([at(c.x, c.z + r), at(c.x, NODE.bottom.z), NODE.bottom]);

    // ブリッジ(ダイヤモンド)。各辺の中央にダイオードの記号
    for (const spec of DIODES) {
      diodeSymbol(ink, spec.anode, spec.cathode);
    }

    // + 側: ブリッジの右の頂点 → 上のレール → 出力端子
    ink.polyline([NODE.plus, at(RAIL.startX, NODE.plus.z), at(RAIL.startX, RAIL.plusZ), at(RAIL.endX, RAIL.plusZ)]);
    // − 側: ブリッジの左の頂点 → 交流の配線を飛び越えて → 下のレール → 出力端子
    const hopZ = NODE.bottom.z;
    const hopR = 0.004;
    ink.polyline([NODE.minus, at(NODE.minus.x, hopZ - hopR)]);
    ink.polyline(arcPoints(at(NODE.minus.x, hopZ), hopR, Z_AXIS, X_AXIS, Math.PI, 2 * Math.PI, 10));
    ink.polyline([at(NODE.minus.x, hopZ + hopR), at(NODE.minus.x, RAIL.minusZ), at(RAIL.endX, RAIL.minusZ)]);

    // コンデンサの枝: + レール → スイッチ → 極板 → − レール
    const { hinge, length } = SWITCH;
    ink.segment(at(X_CAP, RAIL.plusZ), hinge);
    ink.circle(hinge, 0.0012, X_AXIS, Z_AXIS, 8);
    const contact = at(X_CAP, hinge.z + length);
    ink.circle(contact, 0.0012, X_AXIS, Z_AXIS, 8);
    ink.segment(contact, at(X_CAP, CAP_PLATES_Z[0]));
    ink.segment(at(X_CAP - 0.008, CAP_PLATES_Z[0]), at(X_CAP + 0.008, CAP_PLATES_Z[0]));
    ink.segment(at(X_CAP - 0.008, CAP_PLATES_Z[1]), at(X_CAP + 0.008, CAP_PLATES_Z[1]));
    ink.segment(at(X_CAP, CAP_PLATES_Z[1]), at(X_CAP, RAIL.minusZ));

    // 負荷抵抗の枝(ジグザグ)
    const [r0, r1] = RES_SPAN;
    ink.segment(at(X_RES, RAIL.plusZ), at(X_RES, r0));
    const zig: Vector3[] = [at(X_RES, r0)];
    for (let i = 1; i < 12; i++) {
      zig.push(at(X_RES + (i % 2 === 0 ? -0.004 : 0.004), r0 + ((r1 - r0) * i) / 12));
    }
    zig.push(at(X_RES, r1));
    ink.polyline(zig);
    ink.segment(at(X_RES, r1), at(X_RES, RAIL.minusZ));

    // 接続点と出力端子
    for (const p of [NODE.top, NODE.bottom, NODE.minus, NODE.plus, at(X_CAP, RAIL.plusZ), at(X_RES, RAIL.plusZ), at(X_CAP, RAIL.minusZ), at(X_RES, RAIL.minusZ)]) {
      ink.circle(p, 0.0015, X_AXIS, Z_AXIS, 8);
    }
    ink.circle(at(RAIL.endX, RAIL.plusZ), 0.003, X_AXIS, Z_AXIS, 16);
    ink.circle(at(RAIL.endX, RAIL.minusZ), 0.003, X_AXIS, Z_AXIS, 16);

    const lines = ink.build(this.inkMaterial);
    this.root.add(lines);
    return lines;
  }

  /** スイッチのレバーは回転させるので別に持つ(ヒンジを原点にする) */
  private buildSwitchLever(): void {
    this.switchLever.position.copy(SWITCH.hinge);
    this.switchLever.add(new LineBuilder().segment(new Vector3(0, 0, 0), new Vector3(0, 0, SWITCH.length)).build(this.switchMaterial));
    this.root.add(this.switchLever);
  }

  /** 直流側(+ / − のレールと出力端子)をなぞる線。コンデンサが入った瞬間に光らせる */
  private buildRailFlash(): LineBasicMaterial {
    const material = this.fader.line(COLOR.charge, 0);
    const y = Y_INK * 1.5;
    const flash = new LineBuilder()
      .polyline([at(RAIL.startX, RAIL.plusZ, y), at(RAIL.endX, RAIL.plusZ, y)])
      .polyline([at(NODE.minus.x, RAIL.minusZ, y), at(RAIL.endX, RAIL.minusZ, y)])
      .circle(at(RAIL.endX, RAIL.plusZ, y), 0.0045, X_AXIS, Z_AXIS, 16)
      .circle(at(RAIL.endX, RAIL.minusZ, y), 0.0045, X_AXIS, Z_AXIS, 16);
    this.root.add(flash.build(material));
    return material;
  }

  private addBody(builder: LineBuilder, footprintX: number, color: number = COLOR.body): Body {
    const material = this.fader.line(color, 0.95);
    const group = new Group();
    group.add(builder.build(material));
    this.root.add(group);
    const body: Body = { group, material, riseAt: riseStart(footprintX) };
    this.bodies.push(body);
    return body;
  }

  /** 交流電源: 記号を縦に起こしたリング */
  private buildSource(): Body {
    const { center: c, radius: r } = SOURCE;
    const hub = at(c.x, c.z, 0.004 + r);
    const b = new LineBuilder().circle(hub, r, X_AXIS, Y_AXIS, 40).circle(hub, r * 0.86, X_AXIS, Y_AXIS, 40);
    const sine: Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      sine.push(new Vector3(hub.x - r * 0.62 + u * r * 1.24, hub.y + Math.sin(u * Math.PI * 2) * r * 0.32, hub.z));
    }
    b.polyline(sine);
    b.segment(at(c.x, c.z, 0.004), at(c.x, c.z, Y_INK));
    return this.addBody(b, c.x);
  }

  /** ダイオード: 辺に沿って寝かせた円柱。カソード側に帯 */
  private buildDiode(spec: DiodeSpec): Body {
    const dir = new Vector3().subVectors(spec.cathode, spec.anode);
    const mid = new Vector3().addVectors(spec.anode, spec.cathode).multiplyScalar(0.5);
    const unit = dir.clone().normalize();
    const radius = 0.0032;
    const half = 0.008;
    const y = radius + 0.0008;
    const a = mid.clone().addScaledVector(unit, -half).setY(y);
    const c = mid.clone().addScaledVector(unit, half).setY(y);
    const b = new LineBuilder().cylinder(a, c, radius, { longitudes: 8, rings: [0.72, 0.8] });
    // リード線: 本体の両端から床の接続点へ
    b.segment(a, mid.clone().addScaledVector(unit, -half - 0.004).setY(Y_INK));
    b.segment(c, mid.clone().addScaledVector(unit, half + 0.004).setY(Y_INK));
    return this.addBody(b, mid.x);
  }

  /** 平滑コンデンサ: 極板の上に立つ電解コンデンサ */
  private buildCapacitor(): Body {
    const z = (CAP_PLATES_Z[0] + CAP_PLATES_Z[1]) / 2;
    const radius = 0.0075;
    const base = at(X_CAP, z, 0.001);
    const top = at(X_CAP, z, 0.024);
    const b = new LineBuilder().cylinder(base, top, radius, { longitudes: 12, rings: [0.08, 0.92] });
    // 天面の防爆弁(十字)
    b.segment(top.clone().add(new Vector3(-radius * 0.7, 0, 0)), top.clone().add(new Vector3(radius * 0.7, 0, 0)));
    b.segment(top.clone().add(new Vector3(0, 0, -radius * 0.7)), top.clone().add(new Vector3(0, 0, radius * 0.7)));
    return this.addBody(b, X_CAP, COLOR.bodyIdle);
  }

  /** コンデンサの中で上下する輪。立ち上がりのアニメーションとは別に、高さだけを動かす */
  private buildChargeRing(): Group {
    const z = (CAP_PLATES_Z[0] + CAP_PLATES_Z[1]) / 2;
    const ring = new Group();
    ring.position.set(X_CAP, 0, z);
    ring.add(new LineBuilder().circle(new Vector3(), 0.0068, X_AXIS, Z_AXIS, 24).build(this.chargeRingMaterial));
    this.root.add(ring);
    return ring;
  }

  /** 負荷抵抗: ジグザグの上に寝かせた円柱。カラーコードの帯 */
  private buildResistor(): Body {
    const [r0, r1] = RES_SPAN;
    const radius = 0.0034;
    const y = radius + 0.0008;
    const a = at(X_RES, r0 + 0.003, y);
    const c = at(X_RES, r1 - 0.003, y);
    const b = new LineBuilder().cylinder(a, c, radius, { longitudes: 8, rings: [0.2, 0.32, 0.44, 0.78] });
    b.segment(a, at(X_RES, r0 - 0.002));
    b.segment(c, at(X_RES, r1 + 0.002));
    return this.addBody(b, X_RES);
  }

  private buildLabels(): void {
    const flat = (text: string, x: number, z: number, anchorX: 'left' | 'center' | 'right' = 'center', size = 0.0065): void => {
      const label = floorLabel(this.fader, text, x, z, { size, color: COLOR.label, anchorX }, 0);
      this.root.add(label);
      this.labels.push(label);
    };

    flat('AC IN', SOURCE.center.x, SOURCE.center.z + SOURCE.radius + 0.042);
    flat('10 V / 1.08 Hz', SOURCE.center.x, SOURCE.center.z + SOURCE.radius + 0.052, 'center', 0.0046);
    const center = new Vector3().addVectors(NODE.top, NODE.bottom).multiplyScalar(0.5);
    for (const spec of DIODES) {
      const mid = new Vector3().addVectors(spec.anode, spec.cathode).multiplyScalar(0.5);
      const out = mid.clone().sub(center).setY(0).normalize().multiplyScalar(0.013);
      flat(spec.name, mid.x + out.x, mid.z + out.z);
    }
    flat('S', X_CAP + 0.011, SWITCH.hinge.z + SWITCH.length / 2);
    flat('C', X_CAP + 0.016, (CAP_PLATES_Z[0] + CAP_PLATES_Z[1]) / 2);
    flat('R', X_RES + 0.013, (RES_SPAN[0] + RES_SPAN[1]) / 2);
    flat('+', RAIL.endX + 0.009, RAIL.plusZ);
    flat('-', RAIL.endX + 0.009, RAIL.minusZ);
    flat('DC OUT', RAIL.endX + 0.002, (RAIL.plusZ + RAIL.minusZ) / 2, 'center');
  }

  /** 机の奥に立てる、オシロスコープ風の波形パネル */
  private buildPanel(kind: 'in' | 'out', centerX: number, width: number, title: string): Panel {
    const height = PANEL.height;
    const group = new Group();
    group.position.set(centerX, PANEL.base, PANEL.z);

    const back = new Mesh(
      new PlaneGeometry(width, height),
      this.fader.add(new MeshBasicMaterial({ color: COLOR.floor, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide })),
    );
    back.position.y = height / 2;
    group.add(back);

    const frameMaterial = this.fader.line(COLOR.gridMajor, 0.7);
    const frame = new LineBuilder().polyline(
      [new Vector3(-width / 2, 0, 0), new Vector3(width / 2, 0, 0), new Vector3(width / 2, height, 0), new Vector3(-width / 2, height, 0)],
      true,
    );
    // 足(床まで)
    frame.segment(new Vector3(-width / 2, 0, 0), new Vector3(-width / 2, -PANEL.base, 0));
    frame.segment(new Vector3(width / 2, 0, 0), new Vector3(width / 2, -PANEL.base, 0));
    group.add(frame.build(frameMaterial));

    const graticule = new LineBuilder();
    for (let i = 1; i < 10; i++) {
      const x = -width / 2 + (width * i) / 10;
      graticule.segment(new Vector3(x, 0, 0), new Vector3(x, height, 0));
    }
    for (let i = 1; i < 4; i++) {
      graticule.segment(new Vector3(-width / 2, (height * i) / 4, 0), new Vector3(width / 2, (height * i) / 4, 0));
    }
    group.add(graticule.build(this.fader.line(COLOR.gridMinor, 0.18)));

    const axisY = kind === 'out' ? outBaseline(height) : height / 2;
    group.add(
      new LineBuilder()
        .segment(new Vector3(-width / 2, axisY, 0), new Vector3(width / 2, axisY, 0))
        .build(this.fader.line(COLOR.gridMajor, 0.45)),
    );

    const trace = new DynamicLine(TRACE_SAMPLES, this.fader.line(kind === 'out' ? COLOR.traceOut : COLOR.traceIn, 1));
    // パネルの面とグリッドより手前に見せる
    trace.line.position.z = 0.0005;
    group.add(trace.line);

    const label = standLabel(this.fader, title, -width / 2, height + 0.003, 0, { size: 0.006, color: COLOR.label, anchorX: 'left', anchorY: 'bottom' }, 0);
    group.add(label);
    this.labels.push(label);

    this.root.add(group);
    return { group, width, height, trace, title: label, frame: frameMaterial };
  }
}

function outBaseline(height: number): number {
  return height * 0.12;
}

/** 床に描くダイオードの記号(三角 + 棒)と、両端の接続点までの配線 */
function diodeSymbol(ink: LineBuilder, anode: Vector3, cathode: Vector3): void {
  const dir = new Vector3().subVectors(cathode, anode).normalize();
  const normal = new Vector3(-dir.z, 0, dir.x);
  const mid = new Vector3().addVectors(anode, cathode).multiplyScalar(0.5);
  const s = 0.0045;
  const baseCenter = mid.clone().addScaledVector(dir, -s);
  const apex = mid.clone().addScaledVector(dir, s);
  ink.segment(anode, baseCenter);
  ink.polyline(
    [baseCenter.clone().addScaledVector(normal, s), apex, baseCenter.clone().addScaledVector(normal, -s)],
    true,
  );
  ink.segment(apex.clone().addScaledVector(normal, s), apex.clone().addScaledVector(normal, -s));
  ink.segment(apex, cathode);
}

export const rectifier = defineScene('rectifier', (ctx) => new RectifierView(ctx.beats));
