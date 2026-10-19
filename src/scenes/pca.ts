import { BufferGeometry, DynamicDrawUsage, Euler, Float32BufferAttribute, Group, Matrix4, Points, PointsMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { seededRandom } from '../sim/random';
import { Fader, PALETTE, defineScene, easeInOutCubic, floorLabel, progress, setText, standLabel } from './kit';

/**
 * #6 次元: 一点に潰れていた点群が、第1・第2・第3主成分の向きに順に広がり、0次元から3次元になる。
 * 主成分の軸もその順に立ち上がる。2小節を想定。
 */

const COUNT = 420;
const CENTER = new Vector3(0, 0.085, 0);
/** 各主成分の標準偏差 [m] */
const SIGMA = [0.055, 0.026, 0.012] as const;
/** k 番目の主成分が広がる区間 [拍] */
const SPREAD: readonly (readonly [number, number])[] = [[1, 2.5], [3, 4.5], [5, 6.5]];
const AXIS_COLORS = [PALETTE.warm, PALETTE.cyan, PALETTE.glow] as const;

/** 標準正規分布(Box–Muller) */
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

export const pca = defineScene('pca', () => {
  const fader = new Fader();
  const root = new Group();

  // 点群は主成分の座標で作り、回転して置く(回転の列が主成分の向き)
  const basis = new Matrix4().makeRotationFromEuler(new Euler(0.5, 0.7, -0.35));
  const axes = [0, 1, 2].map((k) => new Vector3().setFromMatrixColumn(basis, k));
  const random = seededRandom(6);
  const coords = Array.from({ length: COUNT }, () => SIGMA.map((s) => gaussian(random) * s));

  const positions = new Float32BufferAttribute(new Float32Array(COUNT * 3), 3);
  positions.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  const cloud = new Points(geometry, fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.0035, depthWrite: false })));
  cloud.frustumCulled = false;
  root.add(cloud);

  // 主成分の軸(中心から ±2σ)と名前
  const axisLines = axes.map((axis, k) => {
    const length = (SIGMA[k] ?? 0) * 2.2;
    const line = new LineBuilder()
      .segment(axis.clone().multiplyScalar(-length), axis.clone().multiplyScalar(length))
      .build(fader.line(AXIS_COLORS[k] ?? PALETTE.ink, 1));
    line.position.copy(CENTER);
    root.add(line);
    const tip = CENTER.clone().addScaledVector(axis, length + 0.008);
    const label = standLabel(fader, `PC${k + 1}`, tip.x, tip.y, tip.z, { size: 0.0065, color: AXIS_COLORS[k] ?? PALETTE.label });
    root.add(label);
    return { line, label };
  });

  // 床への影(点群の投影)
  const shadow = new Points(geometry, fader.add(new PointsMaterial({ color: PALETTE.dim, size: 0.0025, depthWrite: false })));
  shadow.scale.y = 0;
  shadow.position.y = 0.001;
  shadow.frustumCulled = false;
  root.add(shadow);

  const dimension = standLabel(fader, '', -0.18, 0.012, -0.12, { anchorX: 'left', anchorY: 'bottom', size: 0.009, color: PALETTE.glow });
  root.add(dimension);
  root.add(floorLabel(fader, 'cov(X) v_k = lambda_k v_k', -0.18, 0.13, { anchorX: 'left' }));

  const p = new Vector3();
  return {
    root,
    fader,
    update(beat) {
      const spread = SPREAD.map((range) => easeInOutCubic(progress(beat, range)));
      coords.forEach((c, i) => {
        p.copy(CENTER);
        axes.forEach((axis, k) => p.addScaledVector(axis, (c[k] ?? 0) * (spread[k] ?? 0)));
        positions.setXYZ(i, p.x, p.y, p.z);
      });
      positions.needsUpdate = true;
      axisLines.forEach(({ line, label }, k) => {
        const s = Math.max(spread[k] ?? 0, 1e-4);
        line.scale.setScalar(s);
        fader.set(label, spread[k] ?? 0);
      });
      setText(dimension, `dim = ${spread.filter((s) => s > 0.5).length}`);
    },
  };
});
