import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  Matrix4,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import { covariance3, symmetricEigen2, symmetricEigen3 } from '../sim/pca';
import { seededRandom } from '../sim/random';
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
  standLabel,
  titleBlock,
} from './kit';
import { arrow, dashed, panel } from './parts/verseB';

/**
 * #6 次元: 宙に浮く点群(600点)の共分散行列を実際に固有分解し、第1・第2・第3主成分の軸を順に立ち上げる。
 * 点群は最初は平均の一点(0次元)に潰れていて、軸が立つたびにその向きへ広がり、1 → 2 → 3次元になる。
 * - 1小節目: 0D → 1D → 2D(左奥に共分散行列、右奥に寄与率の棒グラフ)
 * - 2小節目の頭(シーンの 4拍目、キーワード): 第3主成分が開いて 3D。軸が光り、床に射影の影と 2σ の楕円が出る
 * - 残り: 図全体がゆっくり回り、奥行きを見せる
 */

const COUNT = 600;
/** 点群の中心(ステージ座標) */
const CENTER = new Vector3(0, 0.092, -0.01);
/** 生成に使う、各主成分の標準偏差 [m] */
const SIGMA = [0.048, 0.021, 0.0095] as const;
/** k 番目の主成分が開く区間 [拍]。第3主成分はキーワードの小節の頭 */
const SPREAD: readonly (readonly [number, number])[] = [
  [0.5, 1.75],
  [2, 3.25],
  [4, 5],
];
/** キーワードの小節の頭(第3主成分が開き、軸が光る) [拍] */
const HERO = 4;
/** 3D になったあと、図全体を回す区間 [拍]と角度 [rad] */
const TURN: readonly [number, number] = [5, 8.5];
const TURN_ANGLE = 0.5;
const AXIS_COLORS = [PALETTE.warm, PALETTE.cyan, PALETTE.glow] as const;

const MATRIX = { x: -0.188, top: 0.078, z: -0.115, line: 0.0105, size: 0.0056 } as const;
const BARS = { x0: 0.088, x1: 0.19, y0: 0.012, y1: 0.088, z: -0.115 } as const;
const DIM = { x: -0.185, z: 0.075, box: 0.016 } as const;

/** 標準正規分布(Box–Muller) */
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

const fmt = (x: number, width: number): string => x.toFixed(1).padStart(width);

export const pca = defineScene('pca', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- データ: 回転した異方的な正規分布から作り、その共分散を固有分解する ----
  const basis = new Matrix4().makeRotationFromEuler(new Euler(0.45, 0.65, -0.3));
  const truth = [0, 1, 2].map((k) => new Vector3().setFromMatrixColumn(basis, k));
  const random = seededRandom(6);
  const raw = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const p = new Vector3();
    truth.forEach((axis, k) => p.addScaledVector(axis, gaussian(random) * (SIGMA[k] ?? 0)));
    raw.set([p.x, p.y, p.z], i * 3);
  }
  const { mean, cov } = covariance3(raw);
  const eigen = symmetricEigen3(cov);
  // 固有ベクトルの符号は任意なので、見やすい向き(PC1 は +x、PC2 は +y、PC3 は右手系)にそろえる
  const v1 = new Vector3(...eigen.vectors[0]);
  if (v1.x < 0) v1.negate();
  const v2 = new Vector3(...eigen.vectors[1]);
  if (v2.y < 0) v2.negate();
  const v3 = new Vector3().crossVectors(v1, v2).normalize();
  const axes = [v1, v2, v3];
  const lambda = eigen.values;
  const sigma = lambda.map((l) => Math.sqrt(Math.max(l, 0)));
  const total = lambda[0] + lambda[1] + lambda[2];
  // 各点の主成分の座標
  const coords = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const d = new Vector3((raw[i * 3] ?? 0) - mean[0], (raw[i * 3 + 1] ?? 0) - mean[1], (raw[i * 3 + 2] ?? 0) - mean[2]);
    axes.forEach((axis, k) => (coords[i * 3 + k] = d.dot(axis)));
  }

  // ---- 図(点群、軸、床の影と楕円)。3D になったあと鉛直軸まわりに回すので、CENTER の真下を原点にしたグループに入れる ----
  const figure = new Group();
  figure.position.set(CENTER.x, 0, CENTER.z);
  root.add(figure);
  const local = new Vector3(0, CENTER.y, 0);

  const positions = new BufferAttribute(new Float32Array(COUNT * 3), 3);
  positions.setUsage(DynamicDrawUsage);
  const colors = new BufferAttribute(new Float32Array(COUNT * 3), 3);
  colors.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('color', colors);
  const cloudMaterial = fader.add(new PointsMaterial({ size: 0.0024, vertexColors: true, depthWrite: false }));
  const cloud = new Points(geometry, cloudMaterial);
  cloud.frustumCulled = false;
  figure.add(cloud);

  // 床への射影(同じ点を高さ 0 に潰す)
  const shadowMaterial = fader.add(new PointsMaterial({ color: PALETTE.dim, size: 0.0018, depthWrite: false }));
  const shadow = new Points(geometry, shadowMaterial);
  shadow.scale.y = 1e-4;
  shadow.position.y = Y_INK;
  shadow.frustumCulled = false;
  figure.add(shadow);

  // 主成分の軸(±2.2σ、+側に矢じり、±σ・±2σ に目盛り)
  const axisParts = axes.map((axis, k) => {
    const s = sigma[k] ?? 0;
    const side = axes[(k + 1) % 3] ?? new Vector3(0, 1, 0);
    const builder = new LineBuilder();
    arrow(builder, axis.clone().multiplyScalar(-2.2 * s), axis.clone().multiplyScalar(2.2 * s + 0.006), 0.005, side);
    for (const m of [-2, -1, 1, 2]) {
      const c = axis.clone().multiplyScalar(m * s);
      builder.segment(c.clone().addScaledVector(side, -0.0018), c.clone().addScaledVector(side, 0.0018));
    }
    const material = fader.line(AXIS_COLORS[k] ?? PALETTE.ink, 1);
    const line = builder.build(material);
    line.position.copy(local);
    figure.add(line);
    const tip = local.clone().addScaledVector(axis, 2.2 * s + 0.014);
    const name = standLabel(fader, `PC${k + 1}`, tip.x, tip.y, tip.z, { size: 0.0062, color: AXIS_COLORS[k] ?? PALETTE.label }, 0);
    const value = standLabel(fader, `s = ${(s * 100).toFixed(1)} cm`, tip.x, tip.y - 0.007, tip.z, { size: 0.0042, color: PALETTE.label }, 0);
    figure.add(name, value);
    return { line, material, name, value };
  });

  // 床の 2σ 楕円(射影した点の共分散 [[xx, xz], [xz, zz]] の固有分解)と、その長軸・短軸
  const ellipse = symmetricEigen2(cov[0] ?? 0, cov[2] ?? 0, cov[8] ?? 0);
  const ra = 2 * Math.sqrt(Math.max(ellipse.major, 0));
  const rb = 2 * Math.sqrt(Math.max(ellipse.minor, 0));
  const [ca, sa] = [Math.cos(ellipse.angle), Math.sin(ellipse.angle)];
  const onEllipse = (t: number, scale = 1): Vector3 =>
    new Vector3(scale * (ra * Math.cos(t) * ca - rb * Math.sin(t) * sa), Y_INK * 2, scale * (ra * Math.cos(t) * sa + rb * Math.sin(t) * ca));
  const ellipseBuilder = new LineBuilder().polyline(Array.from({ length: 97 }, (_, i) => onEllipse((i / 96) * Math.PI * 2)));
  dashed(ellipseBuilder, onEllipse(0), onEllipse(Math.PI), 0.004, 0.003);
  dashed(ellipseBuilder, onEllipse(Math.PI / 2), onEllipse((3 * Math.PI) / 2), 0.004, 0.003);
  const ellipseMaterial = fader.line(PALETTE.cyan, 0);
  figure.add(ellipseBuilder.build(ellipseMaterial));
  const ellipseLabel = floorLabel(fader, '2 sigma  proj(x, z)', 0, 0, { size: 0.0045, color: PALETTE.cyan, anchorX: 'left' }, 0);
  const labelAt = onEllipse(-Math.PI / 4, 1.08);
  ellipseLabel.position.set(labelAt.x + 0.004, Y_INK * 2, labelAt.z);
  figure.add(ellipseLabel);

  // ---- 左奥: 共分散行列と固有値(cm²) ----
  root.add(panel(fader, { x0: MATRIX.x - 0.006, x1: MATRIX.x + 0.112, y0: MATRIX.top - 6 * MATRIX.line - 0.004, y1: MATRIX.top + 0.008, z: MATRIX.z, divisions: [0, 0] }, 0.8));
  const c = (r: number, k: number): number => (cov[r * 3 + k] ?? 0) * 1e4;
  const matrixLines = [
    'C = cov(X)   [cm^2]',
    `| ${fmt(c(0, 0), 5)} ${fmt(c(0, 1), 5)} ${fmt(c(0, 2), 5)} |`,
    `| ${fmt(c(1, 0), 5)} ${fmt(c(1, 1), 5)} ${fmt(c(1, 2), 5)} |`,
    `| ${fmt(c(2, 0), 5)} ${fmt(c(2, 1), 5)} ${fmt(c(2, 2), 5)} |`,
    'C v_k = lambda_k v_k',
  ];
  const matrixLabels = matrixLines.map((text, i) => {
    const label = standLabel(fader, text, MATRIX.x, MATRIX.top - i * MATRIX.line, MATRIX.z, { anchorX: 'left', anchorY: 'top', size: MATRIX.size }, 0);
    root.add(label);
    return label;
  });
  const lambdaCaption = standLabel(fader, 'lambda:', MATRIX.x, MATRIX.top - 5 * MATRIX.line, MATRIX.z, { anchorX: 'left', anchorY: 'top', size: MATRIX.size }, 0);
  root.add(lambdaCaption);
  const eigenLabels = lambda.map((l, k) => {
    const color = AXIS_COLORS[k] ?? PALETTE.label;
    const x = MATRIX.x + 0.036 + k * 0.026;
    const label = standLabel(fader, (l * 1e4).toFixed(1), x, MATRIX.top - 5 * MATRIX.line, MATRIX.z, { anchorX: 'left', anchorY: 'top', size: MATRIX.size, color }, 0);
    root.add(label);
    return label;
  });

  // ---- 右奥: 寄与率の棒グラフと累積 ----
  root.add(panel(fader, { x0: BARS.x0, x1: BARS.x1, y0: BARS.y0, y1: BARS.y1, z: BARS.z, divisions: [0, 4] }));
  root.add(standLabel(fader, 'explained variance', BARS.x0, BARS.y1 + 0.004, BARS.z, { anchorX: 'left', anchorY: 'bottom', size: 0.0052 }));
  const barW = 0.016;
  const barX = (k: number): number => BARS.x0 + 0.017 + k * 0.03;
  const barH = (k: number): number => ((lambda[k] ?? 0) / total) * (BARS.y1 - BARS.y0 - 0.006);
  const bars = [0, 1, 2].map((k) => {
    const x = barX(k);
    const h = barH(k);
    // 下端を原点にして作り、y 方向の拡大で伸ばす
    const builder = new LineBuilder().polyline(
      [new Vector3(x, 0, BARS.z), new Vector3(x + barW, 0, BARS.z), new Vector3(x + barW, h, BARS.z), new Vector3(x, h, BARS.z)],
      true,
    );
    // 中を斜線で塗る
    for (let t = 0.003; t < h + barW; t += 0.003) {
      builder.segment(new Vector3(x + Math.max(0, t - h), Math.min(t, h), BARS.z), new Vector3(x + Math.min(t, barW), Math.max(0, t - barW), BARS.z));
    }
    const group = new Group();
    group.add(builder.build(fader.line(AXIS_COLORS[k] ?? PALETTE.ink, 0.9)));
    group.position.y = BARS.y0;
    root.add(group);
    const percent = standLabel(fader, `${(((lambda[k] ?? 0) / total) * 100).toFixed(1)}%`, x + barW / 2, BARS.y0 + h + 0.003, BARS.z, { size: 0.0045, anchorY: 'bottom', color: AXIS_COLORS[k] ?? PALETTE.label }, 0);
    const name = standLabel(fader, `PC${k + 1}`, x + barW / 2, BARS.y0 - 0.003, BARS.z, { size: 0.0042, anchorY: 'top' }, 0);
    root.add(percent, name);
    return { group, percent, name };
  });
  // 累積寄与率(破線の階段)
  const cumulative = new LineBuilder();
  let acc = 0;
  for (let k = 0; k < 3; k++) {
    const prev = acc;
    acc += barH(k);
    dashed(cumulative, new Vector3(barX(k), BARS.y0 + prev, BARS.z + 0.0004), new Vector3(barX(k) + barW + (k < 2 ? 0.014 : 0), BARS.y0 + acc, BARS.z + 0.0004), 0.003, 0.002);
  }
  const cumulativeMaterial = fader.line(PALETTE.ink, 0);
  root.add(cumulative.build(cumulativeMaterial));
  const cumulativeLabel = standLabel(fader, 'cumulative', BARS.x1 - 0.003, BARS.y1 - 0.004, BARS.z, { anchorX: 'right', anchorY: 'top', size: 0.0042 }, 0);
  root.add(cumulativeLabel);

  // ---- 左手前: 次元の表示(0 1 2 3 の箱。いまの次元が光る) ----
  const dimBoxes = [0, 1, 2, 3].map((d) => {
    const x = DIM.x + d * (DIM.box + 0.004);
    const builder = new LineBuilder().polyline(
      [new Vector3(x, Y_INK, DIM.z), new Vector3(x + DIM.box, Y_INK, DIM.z), new Vector3(x + DIM.box, Y_INK, DIM.z + DIM.box), new Vector3(x, Y_INK, DIM.z + DIM.box)],
      true,
    );
    const material = fader.line(PALETTE.ink, 0.5);
    root.add(builder.build(material));
    const label = floorLabel(fader, `${d}D`, x + DIM.box / 2, DIM.z + DIM.box / 2, { size: 0.0062 }, 0.5);
    root.add(label);
    return { material, label };
  });
  root.add(floorLabel(fader, 'dim', DIM.x, DIM.z - 0.006, { size: 0.0048, anchorX: 'left' }));
  root.add(floorLabel(fader, 'X: 600 samples in R^3', DIM.x, DIM.z + DIM.box + 0.01, { size: 0.0046, anchorX: 'left' }));

  root.add(titleBlock(fader, 6, 'PRINCIPAL COMPONENTS', 'N = 600 / JACOBI EIGEN OF COV(X)'));

  const p = new Vector3();
  const color = new Color();
  const cyan = new Color(PALETTE.cyan);
  const warm = new Color(PALETTE.warm);
  const white = new Color(PALETTE.glow);
  const labelsShown = (labels: readonly Text[], k: number): void => labels.forEach((l) => fader.set(l, k));

  return {
    root,
    fader,
    update(beat, ctx) {
      const spread = SPREAD.map((range) => easeInOutCubic(progress(beat, range)));
      const [s1 = 0, s2 = 0, s3 = 0] = spread;
      for (let i = 0; i < COUNT; i++) {
        const c1 = (coords[i * 3] ?? 0) * s1;
        const c2 = (coords[i * 3 + 1] ?? 0) * s2;
        const c3 = (coords[i * 3 + 2] ?? 0) * s3;
        p.copy(local).addScaledVector(v1, c1).addScaledVector(v2, c2).addScaledVector(v3, c3);
        positions.setXYZ(i, p.x, p.y, p.z);
        // 第3主成分の座標で色分けする(3D になったときに奥行きが色で分かる)
        const depth = Math.tanh((coords[i * 3 + 2] ?? 0) / (sigma[2] ?? 1)) * s3;
        color.copy(white).lerp(depth >= 0 ? warm : cyan, Math.abs(depth) * 0.85);
        colors.setXYZ(i, color.r, color.g, color.b);
      }
      positions.needsUpdate = true;
      colors.needsUpdate = true;
      // 0D のときは平均の一点がまぶしく見えないよう、点を少し小さく
      cloudMaterial.size = 0.0016 + 0.0008 * clamp01(s1 * 3);

      const pulse = beatPulse(ctx, 0.3);
      const current = spread.filter((s) => s > 0.5).length;
      axisParts.forEach(({ line, material, name, value }, k) => {
        const s = spread[k] ?? 0;
        line.scale.setScalar(Math.max(easeOutCubic(clamp01(s * 1.2)), 1e-4));
        // いちばん新しく開いた軸は拍で光る。キーワードの小節の頭では全部の軸が光る
        const accent = k === current - 1 ? 0.35 * pulse : 0;
        const hero = beat >= HERO ? 0.5 * Math.exp(-(beat - HERO) / 0.6) : 0;
        fader.set(material, Math.min(1, 0.65 + accent + hero) * (s > 0 ? 1 : 0));
        labelsShown([name, value], progress(beat, [(SPREAD[k] ?? [0, 1])[0] + 0.5, (SPREAD[k] ?? [0, 1])[1]]));
      });

      // 床の影と楕円は 3D になってから
      const floorIn = progress(beat, [HERO, HERO + 1]);
      fader.set(shadowMaterial, 0.8 * floorIn);
      fader.set(ellipseMaterial, 0.75 * floorIn);
      fader.set(ellipseLabel, floorIn);
      figure.rotation.y = TURN_ANGLE * easeInOutCubic(progress(beat, TURN));

      // 共分散行列は頭に打ち出し、固有値は軸が開くたびに出す
      matrixLabels.forEach((label, i) => fader.set(label, progress(beat, [i * 0.12, i * 0.12 + 0.4]) * (i === 4 ? progress(beat, [1, 1.5]) : 1)));
      fader.set(lambdaCaption, progress(beat, [0.5, 1]));
      eigenLabels.forEach((label, k) => fader.set(label, progress(beat, [(SPREAD[k] ?? [0, 1])[0], (SPREAD[k] ?? [0, 1])[1]])));

      // 寄与率の棒は、その主成分が開くのに合わせて伸びる
      bars.forEach(({ group, percent, name }, k) => {
        const s = spread[k] ?? 0;
        group.scale.y = Math.max(s, 1e-4);
        fader.set(percent, progress(s, [0.8, 1]));
        fader.set(name, Math.min(1, beat / 0.75));
      });
      fader.set(cumulativeMaterial, 0.6 * progress(beat, [5, 5.75]));
      fader.set(cumulativeLabel, 0.8 * progress(beat, [5, 5.75]));

      dimBoxes.forEach(({ material, label }, d) => {
        const on = d === current;
        material.color.set(on ? PALETTE.warm : PALETTE.ink);
        fader.set(material, on ? 0.7 + 0.3 * pulse : 0.35);
        label.color = on ? PALETTE.warm : PALETTE.label;
        fader.set(label, on ? 1 : 0.4);
      });
    },
  };
});
