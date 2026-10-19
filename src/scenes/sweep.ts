import { Group, Vector3, type LineBasicMaterial } from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { seededRandom } from '../sim/random';
import { classifyPhase, findDomains, meanNormal, skyrmionCores, topologicalCharge, type Domain, type SpinPhase } from '../sim/topology';
import { cornerBrackets, floorAxis } from './parts/chorus';
import {
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
  clamp01,
  defineScene,
  easeInOutCubic,
  easeOutCubic,
  floorLabel,
  progress,
  setText,
  standLabel,
  titleBlock,
} from './kit';
import { SPIN_STEPS_PER_BEAT, SpinField } from './spinField';

/**
 * #14 パラメータスイープ: #5 の小さな世界(スピン格子)を、DM 相互作用 D と磁場 B を変えて 3 × 3 に並べた相図。
 * 世界は左手前から右奥へ順に起動し、それぞれ緩和して、一様な磁化(FM)・らせん / 迷路(HL)・スキルミオン(SkX)に分かれる。
 * 各世界にはトポロジカル電荷 Q と、その場で判定した相を出す。
 *
 * 4小節を想定。前半2小節で全部の世界が走り出し、6拍目から選択のカーソルが世界を渡り歩いて、
 * 後半の頭(8拍目)で一番スキルミオンの多い世界に止まる。選ばれた世界は持ち上がって手前を向き、拡大される。
 */

const NX = 15;
const NY = 11;
const PITCH = 0.0056;
const WORLD = { w: NX * PITCH, d: NY * PITCH } as const;
/** 相図の列(D)と行(B)。B は奥ほど大きい */
const D_VALUES = [0.6, 1.0, 1.4] as const;
const B_VALUES = [0, 0.45, 0.9] as const;
const COLUMN_X = [-0.13, -0.035, 0.06] as const;
const ROW_Z = [0.045, -0.035, -0.115] as const;
const RATE = 0.15;
/**
 * 各世界の乱数の種([B の行][D の列])。ランダムな初期状態から緩和させるので、種によって模様が変わる。
 * 右上(D = 1.4, B = 0.9)は、端に触れないスキルミオンが4つ並び Q ≈ −4 になる種を選んである
 */
const SEEDS = [
  [31, 32, 33],
  [34, 35, 36],
  [37, 38, 117],
] as const;
/** 起動からこの拍数で緩和を打ち切る(ほぼ落ち着いているので、それ以降は計算も描き直しもしない) */
const RELAX_BEATS = 9;

const TIMING = {
  axes: [0, 1.25] as const,
  /** 相図の左手前から右奥へ順に起動する。order 番目の世界が動き出す拍 */
  start: (order: number): number => 0.5 + order * 0.3,
  /** 起動の刺激(枠が広がって消える)にかける拍数 */
  kick: 0.8,
  /** 相の判定を出し始める、起動からの拍数 */
  tag: 2,
  /** 選択のカーソルが渡り歩く区間 */
  scan: [5.5, 8] as const,
  /** 1つの世界に決まる拍(SATISFACTION の行の頭) */
  select: 8,
  /** 選ばれた世界が持ち上がる区間 */
  lift: [8, 10] as const,
  /** スキルミオンの印を出し始める拍 */
  markers: 9.5,
} as const;

/** 選ばれた世界の、持ち上げたあとの姿勢 */
const LIFTED = { position: new Vector3(-0.045, 0.072, -0.02), scale: 1.75, tilt: 0.85 } as const;
const MARKERS = 8;

const PHASE_COLOR: Record<SpinPhase, number> = { FM: PALETTE.dim, HL: PALETTE.cyan, SkX: PALETTE.warm };
const PHASE_NAME: Record<SpinPhase, string> = { FM: 'FERROMAGNET', HL: 'HELICAL / MAZE', SkX: 'SKYRMIONS' };

interface World {
  readonly d: number;
  readonly b: number;
  /** 起動する順番(相図の左手前から右奥へ) */
  order: number;
  readonly home: Vector3;
  readonly group: Group;
  readonly field: SpinField;
  readonly frame: LineBasicMaterial;
  readonly kick: { readonly lines: Group; readonly material: LineBasicMaterial };
  readonly qLabel: Text;
  readonly tagLabel: Text;
  /** 最後に計算したときのステップ数と結果(ステップが進んだときだけ計算し直す) */
  measured: { steps: number; q: number; phase: SpinPhase; domains: Domain[] };
  /** 最後に矢印を描いたときのステップ数と、広がりの半径 */
  drawn: { steps: number; reveal: number };
}

function frameBuilder(w: number, d: number): LineBuilder {
  const y = Y_INK;
  return new LineBuilder().polyline(
    [new Vector3(-w / 2, y, -d / 2), new Vector3(w / 2, y, -d / 2), new Vector3(w / 2, y, d / 2), new Vector3(-w / 2, y, d / 2)],
    true,
  );
}

/** 格子の座標 (x, y) → 世界のグループ内の位置(SpinField の矢印の並びと同じ) */
function latticeToLocal(x: number, y: number, out: Vector3): Vector3 {
  return out.set((x - (NX - 1) / 2) * PITCH, PITCH * 0.45, -(y - (NY - 1) / 2) * PITCH);
}

export const sweep = defineScene('sweep', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- 相図の軸 ----
  const axisMaterial = fader.line(PALETTE.ink, 0.8);
  const axisZ = ROW_Z[0] + WORLD.d / 2 + 0.012;
  const axisX = COLUMN_X[0] - WORLD.w / 2 - 0.012;
  const dAxis = floorAxis(new Vector3(axisX, Y_INK, axisZ), new Vector3(COLUMN_X[2] + WORLD.w / 2 + 0.006, Y_INK, axisZ), axisMaterial);
  const bAxis = floorAxis(new Vector3(axisX, Y_INK, axisZ), new Vector3(axisX, Y_INK, ROW_Z[2] - WORLD.d / 2 - 0.006), axisMaterial);
  root.add(dAxis, bAxis);
  const ticks = new LineBuilder();
  COLUMN_X.forEach((x) => ticks.segment(new Vector3(x, Y_INK, axisZ - 0.003), new Vector3(x, Y_INK, axisZ + 0.003)));
  ROW_Z.forEach((z) => ticks.segment(new Vector3(axisX - 0.003, Y_INK, z), new Vector3(axisX + 0.003, Y_INK, z)));
  root.add(ticks.build(axisMaterial));
  const axisLabels: Text[] = [];
  D_VALUES.forEach((d, i) => axisLabels.push(floorLabel(fader, d.toFixed(1), COLUMN_X[i] ?? 0, axisZ + 0.009, { size: 0.0052 })));
  B_VALUES.forEach((b, i) => axisLabels.push(floorLabel(fader, b === 0 ? '0' : b.toFixed(2).replace(/0$/, ''), axisX - 0.005, ROW_Z[i] ?? 0, { size: 0.0052, anchorX: 'right' })));
  axisLabels.push(floorLabel(fader, 'D/J', COLUMN_X[2] + WORLD.w / 2 + 0.012, axisZ, { size: 0.0058, anchorX: 'left', color: PALETTE.glow }));
  axisLabels.push(floorLabel(fader, 'B/J', axisX, ROW_Z[2] - WORLD.d / 2 - 0.013, { size: 0.0058, color: PALETTE.glow }));
  root.add(...axisLabels);
  const axesGroup = [dAxis, bAxis];

  // ---- 凡例と式(右側) ----
  const legendX = 0.118;
  const legend = new Group();
  root.add(legend);
  legend.add(floorLabel(fader, 'PHASE', legendX, -0.137, { size: 0.0058, anchorX: 'left', color: PALETTE.glow }));
  (['FM', 'HL', 'SkX'] as const).forEach((phase, i) => {
    const z = -0.124 + i * 0.012;
    legend.add(
      new LineBuilder()
        .polyline([new Vector3(legendX, Y_INK, z - 0.003), new Vector3(legendX + 0.008, Y_INK, z - 0.003), new Vector3(legendX + 0.008, Y_INK, z + 0.003), new Vector3(legendX, Y_INK, z + 0.003)], true)
        .build(fader.line(PHASE_COLOR[phase], 1)),
    );
    legend.add(floorLabel(fader, `${phase.padEnd(4)}${PHASE_NAME[phase].toLowerCase()}`, legendX + 0.012, z, { size: 0.005, anchorX: 'left' }));
  });
  legend.add(floorLabel(fader, 'E = -J m_i.m_j', legendX, -0.074, { size: 0.005, anchorX: 'left' }));
  legend.add(floorLabel(fader, '  - D d_ij.(m_i x m_j)', legendX, -0.065, { size: 0.005, anchorX: 'left' }));
  legend.add(floorLabel(fader, '  - B m_z', legendX, -0.056, { size: 0.005, anchorX: 'left' }));
  legend.add(floorLabel(fader, 'Q = (1/4pi) S m.(dxm x dym)', legendX, -0.042, { size: 0.0046, anchorX: 'left' }));
  legend.add(floorLabel(fader, 'N_sk = cores off the edge', legendX, -0.033, { size: 0.0046, anchorX: 'left' }));

  root.add(titleBlock(fader, 14, 'PARAMETER SWEEP', 'PHASE DIAGRAM OF A CHIRAL MAGNET (D, B)'));

  // ---- 3 × 3 の世界 ----
  const worlds: World[] = [];
  B_VALUES.forEach((b, row) => {
    D_VALUES.forEach((d, column) => {
      const home = new Vector3(COLUMN_X[column] ?? 0, 0, ROW_Z[row] ?? 0);
      const group = new Group();
      group.position.copy(home);
      root.add(group);
      const field = new SpinField(NX, NY, { j: 1, d, b, rate: RATE }, SEEDS[row]?.[column] ?? 31, PITCH, new Vector3(), fader);
      group.add(field.mesh);
      const frame = fader.line(PALETTE.ink, 0.6);
      group.add(frameBuilder(WORLD.w + 0.006, WORLD.d + 0.006).build(frame));
      // 起動の刺激: 枠が外へ広がって消える
      const kickMaterial = fader.line(PALETTE.glow, 0);
      const kickLines = new Group();
      kickLines.add(frameBuilder(WORLD.w + 0.006, WORLD.d + 0.006).build(kickMaterial));
      group.add(kickLines);
      const qLabel = floorLabel(fader, '', -WORLD.w / 2 - 0.003, -WORLD.d / 2 - 0.0075, { size: 0.0048, anchorX: 'left' }, 0);
      const tagLabel = floorLabel(fader, '', WORLD.w / 2 + 0.003, -WORLD.d / 2 - 0.0075, { size: 0.0048, anchorX: 'right' }, 0);
      group.add(qLabel, tagLabel);
      worlds.push({
        d,
        b,
        order: row + column,
        home,
        group,
        field,
        frame,
        kick: { lines: kickLines, material: kickMaterial },
        qLabel,
        tagLabel,
        measured: { steps: -1, q: 0, phase: 'HL', domains: [] },
        drawn: { steps: -1, reveal: Number.NaN },
      });
    });
  });
  // 同じ斜めの列は左から順に起動する
  worlds.sort((p, q) => p.order - q.order || p.home.x - q.home.x);
  worlds.forEach((world, i) => (world.order = i));

  /** 相の判定と Q は、8ステップごと(と緩和を打ち切ったとき)にだけ計算し直す。表示はそれで十分なめらか */
  const capSteps = Math.floor(RELAX_BEATS * SPIN_STEPS_PER_BEAT);
  const measure = (world: World): World['measured'] => {
    const { lattice } = world.field;
    const stale = Math.floor(world.measured.steps / 8) !== Math.floor(lattice.steps / 8) || (lattice.steps === capSteps && world.measured.steps !== capSteps);
    if (stale || lattice.steps < world.measured.steps) {
      const domains = findDomains(lattice.m, NX, NY);
      world.measured = {
        steps: lattice.steps,
        q: topologicalCharge(lattice.m, NX, NY),
        phase: classifyPhase(domains, meanNormal(lattice.m, NX * NY)),
        domains,
      };
    }
    return world.measured;
  };

  // 選ばれる世界: 選ぶ瞬間の状態を、ここで一度計算して決めておく(スキルミオンの数、同じなら |Q| の大きい方)
  const chosen = worlds.reduce<{ world: World; score: number } | null>((best, world) => {
    const steps = Math.floor(Math.min(TIMING.select - TIMING.start(world.order), RELAX_BEATS) * SPIN_STEPS_PER_BEAT);
    for (let k = 0; k < steps; k++) world.field.lattice.step();
    const { q, domains } = measure(world);
    const score = skyrmionCores(domains).length * 10 + Math.abs(q);
    world.field.lattice.reset();
    world.measured = { steps: -1, q: 0, phase: 'HL', domains: [] };
    return best === null || score > best.score ? { world, score } : best;
  }, null)?.world;

  // 選択のカーソルが渡り歩く順(選ばれる世界以外から5つ、最後に選ばれる世界)
  const random = seededRandom(14);
  const others = worlds.filter((w) => w !== chosen);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j] as World, others[i] as World];
  }
  const hops = [...others.slice(0, 5), ...(chosen === undefined ? [] : [chosen])];
  const cursorMaterial = fader.line(PALETTE.warm, 0);
  const cursor = cornerBrackets(WORLD.w + 0.014, WORLD.d + 0.014, 0.014, Y_INK * 3, cursorMaterial);
  root.add(cursor);

  // 選ばれた世界の、スキルミオンの芯を囲む輪
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const markerMaterial = fader.line(PALETTE.warm, 0);
  const markers = Array.from({ length: MARKERS }, () => {
    const ring = new LineBuilder().circle(new Vector3(), PITCH * 1.5, X, Z, 24).build(markerMaterial);
    ring.visible = false;
    chosen?.group.add(ring);
    return ring;
  });

  // 選ばれた世界の上に出す、大きな読み出し
  const readout = standLabel(fader, '', LIFTED.position.x + 0.11, LIFTED.position.y + 0.035, LIFTED.position.z, { size: 0.0135, anchorX: 'left', color: PALETTE.warm }, 0);
  const readoutSub = standLabel(fader, '', LIFTED.position.x + 0.11, LIFTED.position.y + 0.018, LIFTED.position.z, { size: 0.0058, anchorX: 'left' }, 0);
  const readoutParams = standLabel(fader, '', LIFTED.position.x + 0.11, LIFTED.position.y + 0.007, LIFTED.position.z, { size: 0.0052, anchorX: 'left', color: PALETTE.label }, 0);
  root.add(readout, readoutSub, readoutParams);

  const local = new Vector3();
  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);
      const axes = easeOutCubic(progress(beat, TIMING.axes));
      for (const axis of axesGroup) axis.scale.setScalar(Math.max(axes, 1e-4));
      for (const label of axisLabels) fader.set(label, axes);

      const selected = beat >= TIMING.select;
      const lift = easeInOutCubic(progress(beat, TIMING.lift));
      for (const world of worlds) {
        const since = beat - TIMING.start(world.order);
        world.field.advanceTo(Math.min(Math.max(since, 0), RELAX_BEATS));
        const reveal = since < 0 ? -1 : since < 0.6 ? (since / 0.6) * Math.hypot(NX, NY) * 0.5 + 0.5 : Infinity;
        if (world.drawn.steps !== world.field.lattice.steps || world.drawn.reveal !== reveal) {
          world.field.draw(reveal);
          world.drawn = { steps: world.field.lattice.steps, reveal };
        }

        // 起動の刺激
        const kick = clamp01(since / TIMING.kick);
        world.kick.lines.scale.set(1 + 0.35 * easeOutCubic(kick), 1, 1 + 0.35 * easeOutCubic(kick));
        fader.set(world.kick.material, since >= 0 && kick < 1 ? 0.9 * (1 - kick) : 0);

        const { q, phase } = measure(world);
        const tagged = since >= TIMING.tag;
        setText(world.qLabel, since >= 0 ? `Q ${q >= 0 ? '+' : '-'}${Math.abs(q).toFixed(1)}` : '');
        setText(world.tagLabel, tagged ? phase : '');
        world.tagLabel.color = PHASE_COLOR[phase];
        world.frame.color.set(tagged ? PHASE_COLOR[phase] : PALETTE.ink);

        // 選んだあとは、選ばれなかった世界を暗くする
        const isChosen = world === chosen;
        const dim = selected && !isChosen ? 1 - 0.75 * clamp01((beat - TIMING.select) / 1) : 1;
        fader.set(world.field.material, since < 0 ? 0 : dim);
        fader.set(world.frame, (since < 0 ? 0.25 : 0.55 + 0.35 * pulse) * dim);
        fader.set(world.qLabel, since >= 0 ? 0.85 * dim : 0);
        fader.set(world.tagLabel, tagged ? dim : 0);

        if (isChosen) {
          world.group.position.lerpVectors(world.home, LIFTED.position, lift);
          world.group.scale.setScalar(1 + (LIFTED.scale - 1) * lift);
          world.group.rotation.x = LIFTED.tilt * lift;
          if (selected) world.frame.color.set(PALETTE.warm);
        }
      }

      // 選択のカーソル: 6拍目から半拍ごとに世界を渡り、8拍目で選ばれた世界に止まる
      const scanning = beat >= TIMING.scan[0] && beat < TIMING.lift[0] + 0.6;
      const hopIndex = Math.min(hops.length - 1, Math.max(0, Math.floor((beat - TIMING.scan[0]) / 0.5)));
      const from = hops[Math.max(0, hopIndex - 1)]?.home ?? new Vector3();
      const to = hops[hopIndex]?.home ?? new Vector3();
      const hop = easeOutCubic(clamp01(((beat - TIMING.scan[0]) % 0.5) / 0.15));
      cursor.position.lerpVectors(from, to, hopIndex === 0 ? 1 : hop);
      cursor.scale.setScalar(1 + 0.06 * pulse);
      fader.set(cursorMaterial, scanning ? (beat >= TIMING.select ? 1 - (beat - TIMING.select) / 0.6 : 0.85 + 0.15 * pulse) : 0);

      // 選ばれた世界のスキルミオンを輪で囲み、大きな読み出しを出す
      if (chosen !== undefined) {
        const { q, phase, domains } = measure(chosen);
        const cores = skyrmionCores(domains);
        const shown = beat >= TIMING.markers;
        markers.forEach((ring, i) => {
          const core = cores[i];
          ring.visible = shown && core !== undefined;
          if (core !== undefined) {
            latticeToLocal(core.x, core.y, local);
            ring.position.set(local.x, Y_INK * 4, local.z);
            ring.scale.setScalar(1 + 0.18 * pulse);
          }
        });
        fader.set(markerMaterial, shown ? 0.65 + 0.35 * pulse : 0);
        const reveal = clamp01((beat - TIMING.lift[1] + 1) / 1);
        fader.set(readout, reveal);
        fader.set(readoutSub, reveal);
        fader.set(readoutParams, reveal);
        setText(readout, `Q = ${q >= 0 ? '+' : '-'}${Math.abs(q).toFixed(2)}`);
        setText(readoutSub, `${PHASE_NAME[phase]}   N_sk = ${cores.length}`);
        setText(readoutParams, `D/J = ${chosen.d.toFixed(1)}   B/J = ${chosen.b.toFixed(2)}`);
      }
    },
  };
});
