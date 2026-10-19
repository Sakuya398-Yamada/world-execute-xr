import { BoxGeometry, BufferGeometry, DynamicDrawUsage, EdgesGeometry, Float32BufferAttribute, Group, LineSegments, Mesh, MeshBasicMaterial, Points, PointsMaterial, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { Fader, PALETTE, Y_INK, defineScene, easeInOutCubic, floorLabel, progress, smoothstep, stageFloor, standLabel } from './kit';

/**
 * #3 オブジェクト生成: 机に敷いたヒープ領域のセルが確保されるたびに点が湧き、点 → 線 → 面 → 立方体と組み上がって机に着地する。
 * 2小節を想定。
 */

const CELL = { w: 0.038, d: 0.024, cols: 8, rows: 2, z: 0.085 } as const;
const CUBE = { center: new Vector3(0, 0.075, -0.03), half: 0.025 } as const;
/** 確保されるセル(8個 = 立方体の頂点) */
const ALLOCATED = [1, 4, 6, 3, 9, 15, 12, 10] as const;
const TIMING = {
  /** i 番目のセルが確保される拍 */
  alloc: (i: number): number => 0.25 + i * 0.3,
  /** 点が頂点まで飛ぶのにかける拍数 */
  fly: 1.4,
  edges: [3.4, 4.6] as const,
  faces: [4.6, 5.4] as const,
  drop: [5.6, 6.6] as const,
} as const;

const VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(CUBE.half));
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;

function cellCenter(index: number): Vector3 {
  const col = index % CELL.cols;
  const row = Math.floor(index / CELL.cols);
  return new Vector3((col - (CELL.cols - 1) / 2) * CELL.w, Y_INK, CELL.z + (row - 0.5) * CELL.d);
}

/** 着地の跳ね(0〜1 → 0〜1) */
function bounce(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x - 1.5 / d) ** 2 + 0.75;
  if (x < 2.5 / d) return n * (x - 2.25 / d) ** 2 + 0.9375;
  return n * (x - 2.625 / d) ** 2 + 0.984375;
}

export const heap = defineScene('heap', () => {
  const fader = new Fader();
  const root = new Group();
  root.add(stageFloor(fader));

  // ヒープ: セルの枠とアドレス。確保されたセルは塗りが光る
  const grid = new LineBuilder();
  const fills: MeshBasicMaterial[] = [];
  for (let i = 0; i < CELL.cols * CELL.rows; i++) {
    const c = cellCenter(i);
    const hw = CELL.w / 2 - 0.0015;
    const hd = CELL.d / 2 - 0.0015;
    grid.polyline([c.clone().add(new Vector3(-hw, 0, -hd)), c.clone().add(new Vector3(hw, 0, -hd)), c.clone().add(new Vector3(hw, 0, hd)), c.clone().add(new Vector3(-hw, 0, hd))], true);
    const fill = fader.add(new MeshBasicMaterial({ color: PALETTE.warm, opacity: 0, depthWrite: false }));
    const plane = new Mesh(new BoxGeometry(hw * 2, 0.0002, hd * 2), fill);
    plane.position.copy(c);
    root.add(plane);
    fills.push(fill);
    root.add(floorLabel(fader, `0x${(0x1000 + i * 0x20).toString(16).toUpperCase()}`, c.x, c.z + CELL.d / 2 - 0.006, { size: 0.0042 }, 0.8));
  }
  root.add(grid.build(fader.line(PALETTE.ink, 0.6)));
  root.add(floorLabel(fader, 'HEAP', -CELL.cols * CELL.w / 2, CELL.z - CELL.d - 0.002, { size: 0.006, anchorX: 'left' }));

  // 立方体: 点(頂点)、辺、面。着地のときは全体を下げる
  const cube = new Group();
  root.add(cube);
  const pointPositions = new Float32BufferAttribute(new Float32Array(8 * 3), 3);
  pointPositions.setUsage(DynamicDrawUsage);
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', pointPositions);
  const points = new Points(pointGeometry, fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.006, depthWrite: false })));
  points.frustumCulled = false;
  root.add(points);
  const edges = new LineBuilder();
  for (const [a, b] of EDGES) edges.segment(VERTICES[a] ?? new Vector3(), VERTICES[b] ?? new Vector3());
  const edgeLines = edges.build(fader.line(PALETTE.glow, 1));
  cube.add(edgeLines);
  const faceMaterial = fader.add(new MeshBasicMaterial({ color: PALETTE.floor, opacity: 0, depthWrite: false }));
  cube.add(new Mesh(new BoxGeometry(CUBE.half * 2, CUBE.half * 2, CUBE.half * 2), faceMaterial));
  const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(CUBE.half * 2, CUBE.half * 2, CUBE.half * 2)), fader.line(PALETTE.warm, 0));
  cube.add(outline);
  const caption = standLabel(fader, 'new Cube()', 0, CUBE.half * 2 + 0.02, CUBE.center.z, { size: 0.0065, color: PALETTE.glow }, 0);
  root.add(caption);

  return {
    root,
    fader,
    update(beat) {
      const drop = bounce(progress(beat, TIMING.drop));
      const centerY = CUBE.center.y + (CUBE.half - CUBE.center.y) * drop;
      cube.position.set(CUBE.center.x, centerY, CUBE.center.z);

      ALLOCATED.forEach((cellIndex, i) => {
        const at = TIMING.alloc(i);
        const lit = beat >= at ? Math.exp(-(beat - at) / 0.6) * 0.5 + 0.18 : 0;
        const fill = fills[cellIndex];
        if (fill !== undefined) fader.set(fill, lit);
        const k = easeInOutCubic(progress(beat, [at, at + TIMING.fly]));
        const from = cellCenter(cellIndex);
        const to = (VERTICES[i] ?? new Vector3()).clone().add(cube.position);
        const p = from.lerp(to, k);
        // 飛んでいる途中は弧を描くように持ち上げる
        pointPositions.setXYZ(i, p.x, p.y + Math.sin(k * Math.PI) * 0.03, p.z);
      });
      pointPositions.needsUpdate = true;
      // 確保された順に点を出す
      pointGeometry.setDrawRange(0, ALLOCATED.filter((_, i) => beat >= TIMING.alloc(i)).length);

      const e = progress(beat, TIMING.edges);
      edgeLines.geometry.setDrawRange(0, Math.floor(e * EDGES.length) * 2);
      fader.set(faceMaterial, 0.16 * smoothstep(progress(beat, TIMING.faces)));
      const landed = progress(beat, [TIMING.drop[1] - 0.2, TIMING.drop[1] + 0.4]);
      fader.set(outline.material, landed);
      fader.set(caption, landed);
    },
  };
});
