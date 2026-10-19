import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
  WireframeGeometry,
} from 'three';
import { seededRandom } from '../sim/random';
import { Fader, PALETTE, clamp01, defineScene, easeOutCubic, floorLabel, progress } from './kit';

/**
 * #2 保護: ステージを覆うワイヤーフレームのドーム(ファラデーケージ)が下から組み上がり、外から来るノイズが表面で弾かれる。
 * 1小節を想定。
 */

const RADIUS = 0.14;
/** ノイズが飛んでくる距離 */
const FAR = 0.34;
const NOISE_COUNT = 70;
/** ノイズの速さ [m/拍] */
const NOISE_SPEED = 0.16;
const BUILD: readonly [number, number] = [0, 2];

export const cage = defineScene('cage', () => {
  const fader = new Fader();
  const root = new Group();

  // ドーム: 球の上半分の辺だけを残し、低い順に並べて下から組み上げる
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
  domeGeometry.setAttribute('position', new Float32BufferAttribute(edges.flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]), 3));
  const domeMaterial = fader.line(PALETTE.ink, 0.55);
  const dome = new LineSegments(domeGeometry, domeMaterial);
  root.add(dome);

  // ノイズ: 上半球のランダムな向きから中心へ向かい、半径 RADIUS で跳ね返る
  const random = seededRandom(2);
  const noise = Array.from({ length: NOISE_COUNT }, () => {
    const theta = random() * Math.PI * 2;
    const elevation = 0.15 + random() * 1.2;
    return {
      dir: new Vector3(Math.cos(theta) * Math.cos(elevation), Math.sin(elevation), Math.sin(theta) * Math.cos(elevation)),
      start: 0.3 + random() * 2.2,
      wobble: random() * Math.PI * 2,
    };
  });
  const noisePositions = new Float32BufferAttribute(new Float32Array(NOISE_COUNT * 3), 3);
  noisePositions.setUsage(DynamicDrawUsage);
  const noiseGeometry = new BufferGeometry();
  noiseGeometry.setAttribute('position', noisePositions);
  const noisePoints = new Points(noiseGeometry, fader.add(new PointsMaterial({ color: PALETTE.warm, size: 0.005, depthWrite: false })));
  noisePoints.frustumCulled = false;
  root.add(noisePoints);

  root.add(floorLabel(fader, 'FARADAY CAGE', 0, RADIUS + 0.012, { size: 0.0065 }));
  root.add(floorLabel(fader, 'E_in = 0', 0, 0, { size: 0.007, color: PALETTE.glow }));

  const side = new Vector3();
  return {
    root,
    fader,
    update(beat) {
      const build = easeOutCubic(progress(beat, BUILD));
      domeGeometry.setDrawRange(0, Math.floor(build * edges.length) * 2);

      let flash = 0;
      noise.forEach((n, i) => {
        const tau = beat - n.start;
        // 中心からの距離: 外から近づき、RADIUS で折り返す
        const travel = Math.max(tau, 0) * NOISE_SPEED;
        const r = RADIUS + Math.abs(FAR - RADIUS - travel);
        const sinceHit = travel - (FAR - RADIUS);
        if (sinceHit >= 0) flash = Math.max(flash, Math.exp(-sinceHit / NOISE_SPEED / 0.25));
        // ノイズらしく、進行方向と直交する向きに細かく揺らす
        side.set(-n.dir.z, 0, n.dir.x).multiplyScalar(0.006 * Math.sin(beat * 23 + n.wobble));
        const p = n.dir.clone().multiplyScalar(tau < 0 ? FAR * 3 : r).add(side);
        noisePositions.setXYZ(i, p.x, p.y, p.z);
      });
      noisePositions.needsUpdate = true;
      fader.set(domeMaterial, 0.55 + 0.45 * clamp01(flash) * build);
    },
  };
});
