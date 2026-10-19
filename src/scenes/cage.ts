import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
  WireframeGeometry,
} from 'three';
import { LineBuilder } from '../gfx/lines';
import { cageFieldLine, inducedCharge, type FieldPoint } from '../sim/cageField';
import { Fader, PALETTE, Y_INK, beatPulse, clamp01, defineScene, easeOutCubic, floorLabel, progress, smoothstep, standLabel, titleBlock } from './kit';

/**
 * #2 保護: 一様な電場 E0(+x 向き)の中に、接地した導体の半球殻(ファラデーケージ)が組み上がる。1小節(4拍)。
 * - 0〜2.5拍: ドームの辺が下から順に組み上がる。まだ閉じていないので、力線はまっすぐ中を通り抜ける
 * - 2.5拍目(キーワード): 殻が閉じる。力線が曲がって表面に吸い込まれ、中の力線が消える(E_in = 0)
 * - 表面には誘導電荷 σ = 3 ε0 E0 cosθ が現れる(−x 側が負、+x 側が正)。色で示す
 * 力線は導体球のまわりの電場の流れ関数から厳密に引いている(src/sim/cageField.ts)。机は対称面として扱う。
 */

const RADIUS = 0.115;
const CENTER = new Vector3(0, 0, -0.01);
const BUILD: readonly [number, number] = [0, 2.5];
/** 殻が閉じて導体として効き始める区間 [拍] */
const CLOSE: readonly [number, number] = [2.3, 2.9];
const X_RANGE = 0.19;
const SAMPLES = 64;
/** 力線を引く面(x 軸を含む面。+z から +y への角)と、軸からの距離 ρ0 */
const PLANES = [15, 45, 75, 105, 135, 165].map((deg) => (deg * Math.PI) / 180);
const RHOS = [0.035, 0.07, 0.1, 0.135];
/** 球をよけて上を通り過ぎる力線(真上の面だけ) */
const OVERHEAD = [0.205];
const DOT_SPACING = 0.03;
/** 力線に沿って流れる点の速さ [m/拍] */
const DOT_SPEED = 0.045;

interface LineSpec {
  readonly phi: number;
  readonly rho0: number;
}

const XS = Array.from({ length: SAMPLES }, (_, i) => -X_RANGE + (2 * X_RANGE * i) / (SAMPLES - 1));
const INK = new Color(PALETTE.ink);
const NEGATIVE = new Color(PALETTE.cyan);
const POSITIVE = new Color(PALETTE.warm);

export const cage = defineScene('cage', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- ドーム: 球の上半分の辺を、低い順に並べて下から組み上げる。色は誘導電荷 ----
  const sphere = new WireframeGeometry(new IcosahedronGeometry(RADIUS, 3));
  const source = sphere.getAttribute('position');
  const edges: [Vector3, Vector3][] = [];
  for (let i = 0; i < source.count; i += 2) {
    const a = new Vector3().fromBufferAttribute(source, i);
    const b = new Vector3().fromBufferAttribute(source, i + 1);
    if (Math.min(a.y, b.y) >= -1e-6) edges.push([a, b]);
  }
  sphere.dispose();
  edges.sort((p, q) => Math.max(p[0].y, p[1].y) - Math.max(q[0].y, q[1].y));
  const domeGeometry = new BufferGeometry();
  domeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(edges.flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z])), 3));
  const domeColors = new BufferAttribute(new Float32Array(edges.length * 6), 3);
  domeColors.setUsage(DynamicDrawUsage);
  domeGeometry.setAttribute('color', domeColors);
  const domeMaterial = fader.add(new LineBasicMaterial({ color: 0xffffff, vertexColors: true, depthWrite: false, opacity: 0.75 }));
  const dome = new LineSegments(domeGeometry, domeMaterial);
  dome.position.copy(CENTER);
  root.add(dome);

  // 殻が閉じた瞬間に、頂点から広がる輪
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const sealMaterial = fader.line(PALETTE.glow, 0);
  const seal = new LineBuilder().circle(new Vector3(), 1, X, Z, 48).build(sealMaterial);
  seal.position.set(CENTER.x, RADIUS, CENTER.z);
  root.add(seal);

  // ---- 力線と、その上を流れる点 ----
  const specs: LineSpec[] = [...PLANES.flatMap((phi) => RHOS.map((rho0) => ({ phi, rho0 }))), ...OVERHEAD.map((rho0) => ({ phi: Math.PI / 2, rho0 }))];
  const maxSegments = specs.length * (SAMPLES + 2);
  const linePositions = new BufferAttribute(new Float32Array(maxSegments * 6), 3);
  linePositions.setUsage(DynamicDrawUsage);
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', linePositions);
  const lineMaterial = fader.line(PALETTE.cyan, 0.42);
  const fieldLines = new LineSegments(lineGeometry, lineMaterial);
  fieldLines.frustumCulled = false;
  root.add(fieldLines);

  const maxDots = Math.ceil((specs.length * 2 * X_RANGE * 1.4) / DOT_SPACING) + specs.length * 2;
  const dotPositions = new BufferAttribute(new Float32Array(maxDots * 3), 3);
  dotPositions.setUsage(DynamicDrawUsage);
  const dotGeometry = new BufferGeometry();
  dotGeometry.setAttribute('position', dotPositions);
  const dotMaterial = fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.0028, depthWrite: false }));
  const dots = new Points(dotGeometry, dotMaterial);
  dots.frustumCulled = false;
  root.add(dots);

  /** 力線の上の点をステージ座標に */
  const toStage = (p: FieldPoint, phi: number, target: Vector3): Vector3 =>
    target.set(CENTER.x + p.x, CENTER.y + p.rho * Math.sin(phi), CENTER.z + p.rho * Math.cos(phi));

  // 球の半径が変わったときだけ、力線を引き直す
  let cachedRadius = -1;
  let pieces: { readonly points: Vector3[]; readonly lengths: number[] }[] = [];
  const rebuild = (radius: number): void => {
    if (radius === cachedRadius) return;
    cachedRadius = radius;
    pieces = [];
    let n = 0;
    for (const { phi, rho0 } of specs) {
      for (const piece of cageFieldLine(rho0, radius, XS)) {
        const points = piece.map((p) => toStage(p, phi, new Vector3()));
        const lengths = [0];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1] ?? new Vector3();
          const b = points[i] ?? new Vector3();
          lengths.push((lengths[i - 1] ?? 0) + a.distanceTo(b));
          if (n < maxSegments) {
            linePositions.setXYZ(n * 2, a.x, a.y, a.z);
            linePositions.setXYZ(n * 2 + 1, b.x, b.y, b.z);
            n += 1;
          }
        }
        pieces.push({ points, lengths });
      }
    }
    linePositions.needsUpdate = true;
    lineGeometry.setDrawRange(0, n * 2);
  };

  // ---- 中の計器、電荷の印、式 ----
  root.add(floorLabel(fader, 'E_in = 0', CENTER.x, CENTER.z + 0.005, { size: 0.0085, color: PALETTE.glow }));
  const probe = new LineBuilder()
    .segment(new Vector3(-0.008, Y_INK * 2, CENTER.z - 0.012), new Vector3(0.008, Y_INK * 2, CENTER.z - 0.012))
    .segment(new Vector3(0, Y_INK * 2, CENTER.z - 0.02), new Vector3(0, Y_INK * 2, CENTER.z - 0.004));
  root.add(probe.build(fader.line(PALETTE.glow, 0.7)));
  const charges = new LineBuilder();
  const minusMarks = new LineBuilder();
  for (let k = 0; k < 5; k++) {
    // 床の縁(球の根元)に、−x 側は −、+x 側は + の印
    const a = Math.PI / 2 + ((k - 2) / 5) * Math.PI * 0.55;
    const r = RADIUS + 0.008;
    const px = CENTER.x + Math.sin(a) * r;
    const pz = CENTER.z + Math.cos(a) * r;
    charges.segment(new Vector3(px - 0.003, Y_INK, pz), new Vector3(px + 0.003, Y_INK, pz)).segment(new Vector3(px, Y_INK, pz - 0.003), new Vector3(px, Y_INK, pz + 0.003));
    minusMarks.segment(new Vector3(-px - 0.003 + 2 * CENTER.x, Y_INK, pz), new Vector3(-px + 0.003 + 2 * CENTER.x, Y_INK, pz));
  }
  const plusMaterial = fader.line(PALETTE.warm, 0);
  const minusMaterial = fader.line(PALETTE.cyan, 0);
  root.add(charges.build(plusMaterial), minusMarks.build(minusMaterial));

  // 外の電場の向き
  root.add(
    new LineBuilder()
      .segment(new Vector3(-0.19, 0.135, CENTER.z), new Vector3(-0.15, 0.135, CENTER.z))
      .segment(new Vector3(-0.15, 0.135, CENTER.z), new Vector3(-0.156, 0.139, CENTER.z))
      .segment(new Vector3(-0.15, 0.135, CENTER.z), new Vector3(-0.156, 0.131, CENTER.z))
      .build(fader.line(PALETTE.cyan, 0.9)),
  );
  root.add(standLabel(fader, 'E_0', -0.17, 0.141, CENTER.z, { size: 0.007, color: PALETTE.cyan, anchorY: 'bottom' }));
  root.add(floorLabel(fader, 'sigma = 3 eps0 E0 cos(theta)', -0.194, 0.118, { anchorX: 'left', size: 0.0055 }));
  root.add(floorLabel(fader, 'phi = -E0 (r - R^3/r^2) cos(theta)', -0.194, 0.134, { anchorX: 'left', size: 0.0048 }, 0.8));

  root.add(titleBlock(fader, 2, 'FARADAY CAGE', 'GROUNDED SHELL IN UNIFORM FIELD'));

  const tmp = new Vector3();
  const color = new Color();
  return {
    root,
    fader,
    update(beat, ctx) {
      const build = easeOutCubic(progress(beat, BUILD));
      domeGeometry.setDrawRange(0, Math.floor(build * edges.length) * 2);
      const closure = smoothstep(progress(beat, CLOSE));
      const pulse = beatPulse(ctx, 0.4);

      // 誘導電荷の色: 閉じてから現れ、拍ごとに少し脈打つ
      const strength = closure * (0.75 + 0.25 * pulse);
      edges.forEach(([a, b], i) => {
        for (const [k, p] of [a, b].entries()) {
          const sigma = inducedCharge(p.x, RADIUS) / 3;
          color.copy(INK).lerp(sigma < 0 ? NEGATIVE : POSITIVE, clamp01(Math.sqrt(Math.abs(sigma)) * strength * 1.2));
          domeColors.setXYZ(i * 2 + k, color.r, color.g, color.b);
        }
      });
      domeColors.needsUpdate = true;
      fader.set(domeMaterial, 0.6 + 0.35 * closure);
      const sinceSeal = beat - BUILD[1];
      seal.scale.setScalar(0.004 + Math.max(sinceSeal, 0) * 0.08);
      fader.set(sealMaterial, sinceSeal >= 0 ? Math.max(0, 1 - sinceSeal / 0.8) : 0);

      // 力線: 殻が閉じるにつれて導体の半径を 0 → R にして、曲がっていくようにする
      rebuild(RADIUS * closure);
      let n = 0;
      for (const { points, lengths } of pieces) {
        const total = lengths[lengths.length - 1] ?? 0;
        let seg = 0;
        for (let s = (beat * DOT_SPEED) % DOT_SPACING; s < total && n < maxDots; s += DOT_SPACING) {
          while (seg < lengths.length - 2 && (lengths[seg + 1] ?? 0) < s) seg += 1;
          const a = points[seg] ?? tmp;
          const b = points[seg + 1] ?? a;
          const l0 = lengths[seg] ?? 0;
          const l1 = lengths[seg + 1] ?? l0;
          tmp.copy(a).lerp(b, l1 > l0 ? (s - l0) / (l1 - l0) : 0);
          dotPositions.setXYZ(n, tmp.x, tmp.y, tmp.z);
          n += 1;
        }
      }
      dotPositions.needsUpdate = true;
      dotGeometry.setDrawRange(0, n);
      fader.set(dotMaterial, 0.5 + 0.4 * closure);
      fader.set(plusMaterial, closure);
      fader.set(minusMaterial, closure);
    },
  };
});
