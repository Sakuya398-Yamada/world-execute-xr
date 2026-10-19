import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type LineSegments,
  type Material,
} from 'three';
import { Text } from 'troika-three-text';
import { arcPoints, LineBuilder } from '../gfx/lines';
import { createLabel } from '../gfx/text';
import { inputVoltage, RectifierSim, unsmoothedOutput, type RectifierParams } from '../sim/bridgeRectifier';
import type { SceneModule } from './types';

/**
 * 「AC から DC へ」: ブループリントの床の上に、ブリッジ全波整流回路をワイヤーフレームで立ち上げる。
 * IN 側のパネルに正弦波、OUT 側のパネルに整流後の波形を出し、途中でコンデンサが入って直流に均される。
 */

// ---- 定数(後で歌に合わせて調整する) ----

/** 回路定数。周波数は目で追える見た目用の値 */
const PARAMS: RectifierParams = { vPeak: 10, freqHz: 1, vf: 0.7, r: 1000, rs: 15, c: 0.006 };

/** シーン内の時刻 [s](シーン開始が 0) */
const TIMING = {
  floorIn: [0, 1],
  draw: [0.4, 2.2],
  rise: [1.4, 3.0],
  panels: [2.0, 3.0],
  labels: [2.4, 3.2],
  /** コンデンサのスイッチが閉じる時刻 */
  capacitorOn: 7.0,
  /** スイッチのレバーが倒れるのにかける時間 */
  switchMotion: 0.3,
} as const;

/** 積分の刻み [s] */
const SIM_STEP = 1 / 960;
const TRACE_SAMPLES = 240;
/** 波形パネルに表示する時間幅 [s](2周期分) */
const TRACE_WINDOW = 2 / PARAMS.freqHz;
const STEPS_PER_SAMPLE = Math.max(1, Math.round(TRACE_WINDOW / TRACE_SAMPLES / SIM_STEP));
/** ダイオードの発光を正規化する基準電流(コンデンサ無しのときの最大電流) */
const I_REF = PARAMS.vPeak / (PARAMS.r + PARAMS.rs);

/** 床の大きさ [m] */
const FLOOR = { width: 0.4, depth: 0.3 } as const;

const COLOR = {
  floor: 0x7fb4ff,
  gridMinor: 0x8fc4ff,
  gridMajor: 0xa9d4ff,
  ink: 0xa9d4ff,
  body: 0x6f9fd6,
  bodyIdle: 0x3a5a82,
  glow: 0xf2fdff,
  traceIn: 0x9ff3ff,
  traceOut: 0xffffff,
  ghost: 0x5f8fc8,
  label: 0xcfe6ff,
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
const RAIL = { plusZ: Z0 - 0.045, minusZ: Z0 + 0.068, endX: 0.165 } as const;
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

// ---- 補助 ----

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const progress = (t: number, [from, to]: readonly [number, number]): number => clamp01((t - from) / (to - from));
const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

function lineMaterial(color: number, opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** 床に描いた線と、そこから立ち上がる立体を対にして持つ */
interface Body {
  readonly group: Group;
  readonly material: LineBasicMaterial;
  /** 立ち上がりを始める時刻(左から右へ順に立ち上げる) */
  readonly riseAt: number;
}

interface Panel {
  readonly group: Group;
  readonly width: number;
  readonly height: number;
  readonly trace: Line;
  readonly title: Text;
}

/** 立ち上げの順番を X 位置から決める */
function riseStart(x: number): number {
  const [from, to] = TIMING.rise;
  const span = to - from - 0.6;
  return from + clamp01((x + FLOOR.width / 2) / FLOOR.width) * span;
}

class RectifierView {
  readonly root = new Group();
  private readonly sim = new RectifierSim(PARAMS, SIM_STEP);

  /** 直近の出力電圧(新しい順に並べるためのリングバッファ) */
  private readonly outRing = new Float32Array(TRACE_SAMPLES);
  private ringHead = 0;
  private ringCount = 0;

  private readonly fadeMaterials: { readonly material: Material; readonly opacity: number }[] = [];
  private readonly ink: LineSegments;
  private readonly bodies: Body[] = [];
  private readonly diodes: { readonly spec: DiodeSpec; readonly body: Body }[] = [];
  private readonly capacitor: Body;
  private readonly resistor: Body;
  private readonly source: Body;
  private readonly switchLever = new Group();
  private readonly labels: Text[] = [];
  private readonly inPanel: Panel;
  private readonly outPanel: Panel;
  private readonly ghost: Line;
  private outTitleSmoothing = false;

  private readonly tmpColor = new Color();
  private readonly baseColor = new Color();
  private readonly glowColor = new Color(COLOR.glow);

  constructor() {
    this.root.name = 'rectifier';
    this.buildFloor();
    this.ink = this.buildSchematic();
    this.source = this.buildSource();
    for (const spec of DIODES) {
      this.diodes.push({ spec, body: this.buildDiode(spec) });
    }
    this.capacitor = this.buildCapacitor();
    this.resistor = this.buildResistor();
    this.buildLabels();

    this.inPanel = this.buildPanel('in', -0.1, 0.17, 'IN   v = Vp*sin(2*pi*f*t)');
    this.outPanel = this.buildPanel('out', 0.09, 0.18, 'OUT  v = |v_in| - 2*Vf');
    this.ghost = this.buildTraceLine(lineMaterial(COLOR.ghost, 0));
    // 均された波形の少し奥に出す
    this.ghost.position.z = 0.0003;
    this.outPanel.group.add(this.ghost);
  }

  update(t: number): void {
    this.advanceSim(t);
    this.animateBuild(t);
    this.animateCircuit(t);
    this.updateTraces();
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Text) {
        object.dispose();
      } else if (object instanceof Mesh || object instanceof Line) {
        object.geometry.dispose();
        const material: Material | Material[] = object.material;
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
      }
    });
  }

  // ---- 時間発展 ----

  private advanceSim(t: number): void {
    if (t < this.sim.time) {
      // 巻き戻されたら最初から計算し直す(状態を持つ回路なので、途中からは再開できない)
      this.sim.reset();
      this.ringHead = 0;
      this.ringCount = 0;
    }
    while (this.sim.time + SIM_STEP <= t) {
      const sample = this.sim.advance(this.sim.time >= TIMING.capacitorOn);
      if (this.sim.steps % STEPS_PER_SAMPLE === 0) {
        this.ringHead = (this.ringHead + 1) % TRACE_SAMPLES;
        this.outRing[this.ringHead] = sample.vOut;
        this.ringCount = Math.min(this.ringCount + 1, TRACE_SAMPLES);
      }
    }
  }

  private animateBuild(t: number): void {
    const floor = smoothstep(progress(t, TIMING.floorIn));
    for (const { material, opacity } of this.fadeMaterials) {
      material.opacity = opacity * floor;
    }

    const draw = progress(t, TIMING.draw);
    const count = this.ink.geometry.getAttribute('position').count;
    this.ink.geometry.setDrawRange(0, Math.floor((draw * count) / 2) * 2);
    // レバーはコンデンサの枝が描かれてから出す
    this.switchLever.visible = draw > 0.85;

    for (const body of this.bodies) {
      const k = easeOutCubic(clamp01((t - body.riseAt) / 0.6));
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
      label.fillOpacity = labels;
    }
  }

  private animateCircuit(t: number): void {
    const s = this.sim.latest;
    const current = clamp01(s.iBridge / I_REF) ** 0.6;
    for (const { spec, body } of this.diodes) {
      const conducting = spec.positiveHalf === s.vIn >= 0;
      this.setGlow(body, COLOR.body, conducting ? current : 0);
    }
    this.setGlow(this.source, COLOR.body, (Math.abs(s.vIn) / PARAMS.vPeak) * 0.6);
    this.setGlow(this.resistor, COLOR.body, (s.vOut / PARAMS.vPeak) * 0.8);

    // スイッチ: capacitorOn の時刻にちょうど接点が閉じるように、その少し前から倒し始める
    const closing = smoothstep(clamp01((t - (TIMING.capacitorOn - TIMING.switchMotion)) / TIMING.switchMotion));
    this.switchLever.rotation.y = SWITCH.openAngle * (1 - closing);
    const connected = t >= TIMING.capacitorOn;
    this.setGlow(this.capacitor, connected ? COLOR.body : COLOR.bodyIdle, connected ? current * 0.8 : 0);

    // コンデンサ無しの波形をゴーストとして残し、均された波形と比べられるようにする
    const ghostMaterial = this.ghost.material;
    if (ghostMaterial instanceof LineBasicMaterial) {
      ghostMaterial.opacity = 0.7 * smoothstep(clamp01((t - TIMING.capacitorOn) / 1.0));
    }
    if (connected !== this.outTitleSmoothing) {
      this.outTitleSmoothing = connected;
      this.outPanel.title.text = connected ? 'OUT  C*dv/dt = (v_r - v)/Rs - v/R' : 'OUT  v = |v_in| - 2*Vf';
      this.outPanel.title.sync();
    }
  }

  private setGlow(body: Body, base: number, amount: number): void {
    this.baseColor.set(base);
    body.material.color.copy(this.tmpColor.lerpColors(this.baseColor, this.glowColor, clamp01(amount)));
  }

  /** 波形パネルの更新。左端が最新で、時間が経つと右へ流れていく(IN から OUT へ左→右に流れる向き) */
  private updateTraces(): void {
    const newest = this.sim.time - (this.sim.steps % STEPS_PER_SAMPLE) * SIM_STEP;
    const dtSample = STEPS_PER_SAMPLE * SIM_STEP;
    const count = this.ringCount;

    const inPos = this.positions(this.inPanel.trace);
    const outPos = this.positions(this.outPanel.trace);
    const ghostPos = this.positions(this.ghost);
    const { width: wIn, height: hIn } = this.inPanel;
    const { width: wOut, height: hOut } = this.outPanel;

    for (let k = 0; k < count; k++) {
      const u = k / (TRACE_SAMPLES - 1);
      const tk = newest - k * dtSample;
      const vIn = inputVoltage(PARAMS, tk);
      const vOut = this.outRing[(this.ringHead - k + TRACE_SAMPLES) % TRACE_SAMPLES] ?? 0;

      inPos[k * 3] = -wIn / 2 + u * wIn;
      inPos[k * 3 + 1] = hIn / 2 + (vIn / PARAMS.vPeak) * hIn * 0.4;
      outPos[k * 3] = -wOut / 2 + u * wOut;
      outPos[k * 3 + 1] = outBaseline(hOut) + (vOut / PARAMS.vPeak) * hOut * 0.78;
      ghostPos[k * 3] = outPos[k * 3] ?? 0;
      ghostPos[k * 3 + 1] = outBaseline(hOut) + (unsmoothedOutput(PARAMS, vIn) / PARAMS.vPeak) * hOut * 0.78;
    }

    for (const line of [this.inPanel.trace, this.outPanel.trace, this.ghost]) {
      const attribute = line.geometry.getAttribute('position');
      attribute.needsUpdate = true;
      line.geometry.setDrawRange(0, count);
    }
  }

  private positions(line: Line): Float32Array {
    const array = line.geometry.getAttribute('position').array;
    if (!(array instanceof Float32Array)) {
      throw new Error('trace の position は Float32Array のはず');
    }
    return array;
  }

  // ---- 構築 ----

  private addFaded<T extends Material & { opacity: number }>(material: T): T {
    this.fadeMaterials.push({ material, opacity: material.opacity });
    material.opacity = 0;
    return material;
  }

  /** ブループリントの床: 薄い青の面、1cm / 5cm のグリッド、二重の枠、右下の表題欄 */
  private buildFloor(): void {
    const { width: w, depth: d } = FLOOR;
    const plane = new Mesh(
      new PlaneGeometry(w, d),
      this.addFaded(
        new MeshBasicMaterial({ color: COLOR.floor, transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide }),
      ),
    );
    plane.rotation.x = -Math.PI / 2;
    this.root.add(plane);

    const minor = new LineBuilder();
    const major = new LineBuilder();
    const y = Y_INK / 2;
    for (let i = 0; i <= Math.round(w / 0.01); i++) {
      const x = -w / 2 + i * 0.01;
      (i % 5 === 0 ? major : minor).segment(new Vector3(x, y, -d / 2), new Vector3(x, y, d / 2));
    }
    for (let i = 0; i <= Math.round(d / 0.01); i++) {
      const z = -d / 2 + i * 0.01;
      (i % 5 === 0 ? major : minor).segment(new Vector3(-w / 2, y, z), new Vector3(w / 2, y, z));
    }
    const inset = 0.006;
    major.polyline(
      [at(-w / 2 + inset, -d / 2 + inset), at(w / 2 - inset, -d / 2 + inset), at(w / 2 - inset, d / 2 - inset), at(-w / 2 + inset, d / 2 - inset)],
      true,
    );
    // 表題欄
    const tb = { x0: 0.07, x1: w / 2 - inset, z0: 0.108, z1: d / 2 - inset };
    major.polyline([at(tb.x0, tb.z0), at(tb.x1, tb.z0), at(tb.x1, tb.z1), at(tb.x0, tb.z1)], true);
    major.segment(at(tb.x0, (tb.z0 + tb.z1) / 2), at(tb.x1, (tb.z0 + tb.z1) / 2));

    this.root.add(minor.build(this.addFaded(lineMaterial(COLOR.gridMinor, 0.16))));
    this.root.add(major.build(this.addFaded(lineMaterial(COLOR.gridMajor, 0.42))));
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
    const railStartX = 0.005;
    ink.polyline([NODE.plus, at(railStartX, NODE.plus.z), at(railStartX, RAIL.plusZ), at(RAIL.endX, RAIL.plusZ)]);
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

    const lines = ink.build(lineMaterial(COLOR.ink, 0.9));
    this.root.add(lines);

    // スイッチのレバーは回転させるので別に持つ(ヒンジを原点にする)
    this.switchLever.position.copy(hinge);
    this.switchLever.add(
      new LineBuilder().segment(new Vector3(0, 0, 0), new Vector3(0, 0, length)).build(lineMaterial(COLOR.glow, 0.95)),
    );
    this.root.add(this.switchLever);
    return lines;
  }

  private addBody(builder: LineBuilder, footprintX: number, color: number = COLOR.body): Body {
    const material = lineMaterial(color, 0.95);
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
    const size = 0.0065;
    const flat = (text: string, x: number, z: number, anchorX: 'left' | 'center' | 'right' = 'center', s = size): void => {
      const label = createLabel(text, { size: s, color: COLOR.label, anchorX });
      label.rotation.x = -Math.PI / 2;
      label.position.copy(at(x, z, Y_INK * 2));
      label.fillOpacity = 0;
      this.root.add(label);
      this.labels.push(label);
    };

    flat('AC IN', SOURCE.center.x, SOURCE.center.z + SOURCE.radius + 0.042);
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
    flat('−', RAIL.endX + 0.009, RAIL.minusZ);
    flat('DC OUT', RAIL.endX + 0.002, (RAIL.plusZ + RAIL.minusZ) / 2, 'center');

    flat('FIG.01  AC -> DC', 0.078, 0.1175, 'left', 0.0058);
    flat('FULL-WAVE BRIDGE RECTIFIER', 0.078, 0.1345, 'left', 0.0048);
  }

  /** 机の奥に立てる、オシロスコープ風の波形パネル */
  private buildPanel(kind: 'in' | 'out', centerX: number, width: number, title: string): Panel {
    const height = PANEL.height;
    const group = new Group();
    group.position.set(centerX, PANEL.base, PANEL.z);

    const back = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ color: COLOR.floor, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide }),
    );
    back.position.y = height / 2;
    group.add(back);

    const frame = new LineBuilder().polyline(
      [new Vector3(-width / 2, 0, 0), new Vector3(width / 2, 0, 0), new Vector3(width / 2, height, 0), new Vector3(-width / 2, height, 0)],
      true,
    );
    // 足(床まで)
    frame.segment(new Vector3(-width / 2, 0, 0), new Vector3(-width / 2, -PANEL.base, 0));
    frame.segment(new Vector3(width / 2, 0, 0), new Vector3(width / 2, -PANEL.base, 0));
    group.add(frame.build(lineMaterial(COLOR.gridMajor, 0.7)));

    const graticule = new LineBuilder();
    for (let i = 1; i < 10; i++) {
      const x = -width / 2 + (width * i) / 10;
      graticule.segment(new Vector3(x, 0, 0), new Vector3(x, height, 0));
    }
    for (let i = 1; i < 4; i++) {
      graticule.segment(new Vector3(-width / 2, (height * i) / 4, 0), new Vector3(width / 2, (height * i) / 4, 0));
    }
    group.add(graticule.build(lineMaterial(COLOR.gridMinor, 0.18)));

    const axisY = kind === 'out' ? outBaseline(height) : height / 2;
    group.add(
      new LineBuilder()
        .segment(new Vector3(-width / 2, axisY, 0), new Vector3(width / 2, axisY, 0))
        .build(lineMaterial(COLOR.gridMajor, 0.45)),
    );

    const trace = this.buildTraceLine(lineMaterial(kind === 'out' ? COLOR.traceOut : COLOR.traceIn, 1));
    group.add(trace);

    const label = createLabel(title, { size: 0.006, color: COLOR.label, anchorX: 'left', anchorY: 'bottom' });
    label.position.set(-width / 2, height + 0.003, 0);
    label.fillOpacity = 0;
    group.add(label);
    this.labels.push(label);

    this.root.add(group);
    return { group, width, height, trace, title: label };
  }

  private buildTraceLine(material: LineBasicMaterial): Line {
    const geometry = new BufferGeometry();
    const attribute = new Float32BufferAttribute(new Float32Array(TRACE_SAMPLES * 3), 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    const line = new Line(geometry, material);
    // 位置を毎フレーム書き換えるので、バウンディングスフィアによるカリングはしない
    line.frustumCulled = false;
    // パネルの面とグリッドより手前に見せる
    line.position.z = 0.0005;
    return line;
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

let view: RectifierView | null = null;

export const rectifier: SceneModule = {
  id: 'rectifier',
  enter(ctx) {
    view = new RectifierView();
    ctx.stage.add(view.root);
  },
  update(_ctx, t) {
    view?.update(t);
  },
  exit(ctx) {
    if (view === null) return;
    ctx.stage.remove(view.root);
    view.dispose();
    view = null;
  },
};
