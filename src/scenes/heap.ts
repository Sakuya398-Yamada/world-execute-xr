import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import type { Text } from 'troika-three-text';
import { LineBuilder } from '../gfx/lines';
import {
  DynamicLine,
  Fader,
  PALETTE,
  Y_INK,
  beatPulse,
  clamp01,
  defineScene,
  easeInOutCubic,
  floorLabel,
  progress,
  setText,
  smoothstep,
  standLabel,
  titleBlock,
} from './kit';

/**
 * #3 オブジェクト生成: 机の手前に敷いたヒープ(16バイトのセル × 32)の上で malloc が3回走り、その中身が立体になる。2小節(8拍)。
 * - 0〜2拍: 頂点の配列(8 × vec3 = 96 B)、辺(12 × 2 × u16 = 48 B)、面(6 × 4 × u16 = 48 B)を順に確保する。
 *   ブロックの頭にはヘッダ、ブロックの間には空き(断片化)がある。頂点(駒)が1つずつ頂点の配列の上に置かれていく
 * - 3〜4.5拍: 頂点が浮き上がって立方体の頂点の位置へ飛ぶ
 * - 4.5〜6拍(キーワード): 辺がつながり、面にハッチングが入る。各ブロックから立方体へ参照の線が伸びる
 * - 6〜6.6拍: 立方体が机に着地する(跳ねて止まる)
 * - そのあと: new Cube() と、オイラー標数 V − E + F = 2
 * 奥の左のパネルに、確保した順に構造体の配置(番地とバイト数)を打つ。
 */

const CELL = { w: 0.0205, d: 0.016, cols: 16, rows: 2, x0: -0.17, z0: 0.052 } as const;
const BASE_ADDRESS = 0x1000;
const CELL_BYTES = 16;
/** 確保するブロック(ヘッダのセルと、中身のセル)。セルの番号は番地の順 */
const BLOCKS = [
  { name: 'v', header: 1, cells: [2, 3, 4, 5, 6, 7], bytes: 96, at: 0.25, decl: 'vec3 v[8];    ' },
  { name: 'e', header: 9, cells: [10, 11, 12], bytes: 48, at: 1.0, decl: 'u16  e[12][2];' },
  { name: 'f', header: 14, cells: [15, 16, 17], bytes: 48, at: 1.75, decl: 'u16  f[6][4]; ' },
] as const;
/** 前から使われているセル(別のオブジェクト) */
const OCCUPIED = [0, 20, 21, 22, 27];

const CUBE = { center: new Vector3(0.055, 0.085, -0.04), half: 0.028 } as const;
const TIMING = {
  /** i 番目の頂点が置かれる拍 */
  lay: (i: number): number => 0.5 + i * 0.22,
  /** i 番目の頂点が飛び始める拍 */
  rise: (i: number): number => 3 + i * 0.12,
  fly: 0.9,
  edges: [4.5, 5.25] as const,
  faces: [5.25, 6.0] as const,
  drop: [6.0, 6.6] as const,
  caption: [6.6, 7.2] as const,
} as const;

const VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(CUBE.half));
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
/** 面(頂点の番号。外から見て反時計回り)と、その法線の軸 */
const FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]] as const;

function cellCenter(index: number, target = new Vector3()): Vector3 {
  const col = index % CELL.cols;
  const row = Math.floor(index / CELL.cols);
  return target.set(CELL.x0 + (col + 0.5) * CELL.w, Y_INK, CELL.z0 + (row + 0.5) * CELL.d);
}

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
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

const FREE = new Color(0x0d1a2c);
const HEADER = new Color(PALETTE.cyan);
const PAYLOAD = new Color(PALETTE.warm);
const OTHER = new Color(PALETTE.idle);

export const heap = defineScene('heap', () => {
  const fader = new Fader();
  const root = new Group();

  // ---- ヒープ: セルの枠、塗り(色でセルの状態)、番地 ----
  const cellCount = CELL.cols * CELL.rows;
  const grid = new LineBuilder();
  const c = new Vector3();
  for (let i = 0; i < cellCount; i++) {
    cellCenter(i, c);
    const hw = CELL.w / 2 - 0.001;
    const hd = CELL.d / 2 - 0.001;
    grid.polyline([c.clone().add(new Vector3(-hw, 0, -hd)), c.clone().add(new Vector3(hw, 0, -hd)), c.clone().add(new Vector3(hw, 0, hd)), c.clone().add(new Vector3(-hw, 0, hd))], true);
  }
  root.add(grid.build(fader.line(PALETTE.ink, 0.5)));
  const fills = new InstancedMesh(
    new PlaneGeometry(CELL.w - 0.003, CELL.d - 0.003).rotateX(-Math.PI / 2),
    fader.add(new MeshBasicMaterial({ color: 0xffffff, opacity: 0.55, depthWrite: false })),
    cellCount,
  );
  const matrix = new Matrix4();
  for (let i = 0; i < cellCount; i++) {
    fills.setMatrixAt(i, matrix.makeTranslation(cellCenter(i, c).setY(Y_INK / 2)));
    fills.setColorAt(i, FREE);
  }
  root.add(fills);
  // セルごとの状態(どのブロックのヘッダ / 中身か、いつ確保されるか)
  const cellState = Array.from({ length: cellCount }, (_, i) => ({ color: OCCUPIED.includes(i) ? OTHER : FREE, at: Infinity }));
  for (const block of BLOCKS) {
    [block.header, ...block.cells].forEach((cell, k) => {
      cellState[cell] = { color: k === 0 ? HEADER : PAYLOAD, at: block.at + k * 0.05 };
    });
  }
  for (let i = 0; i < cellCount; i += 4) {
    const p = cellCenter(i, new Vector3());
    const z = i < CELL.cols ? CELL.z0 - 0.006 : CELL.z0 + CELL.rows * CELL.d + 0.006;
    root.add(floorLabel(fader, hex(BASE_ADDRESS + i * CELL_BYTES), p.x - CELL.w / 2, z, { anchorX: 'left', size: 0.0042 }, 0.75));
  }
  root.add(floorLabel(fader, 'HEAP  16 B / cell', CELL.x0, CELL.z0 - 0.015, { anchorX: 'left', size: 0.0052 }));
  // 確保したブロックの名前(ブロックの下)
  const blockLabels = BLOCKS.map((block) => {
    const a = cellCenter(block.header, new Vector3());
    const label = floorLabel(fader, `${block.name}  ${block.bytes} B`, a.x - CELL.w / 2, CELL.z0 + CELL.rows * CELL.d + 0.014, { anchorX: 'left', size: 0.0046, color: PALETTE.warm }, 0);
    // 2行目にまたがるブロックは、1行目の下に出す
    if (block.header < CELL.cols && (block.cells.at(-1) ?? 0) >= CELL.cols) label.position.z = CELL.z0 - 0.006;
    root.add(label);
    return label;
  });

  // 確保の位置を指す矢印(ヒープの上を動く)
  const cursorMaterial = fader.line(PALETTE.glow, 0);
  const cursor = new LineBuilder()
    .segment(new Vector3(0, 0.014, 0), new Vector3(0, 0.003, 0))
    .segment(new Vector3(0, 0.003, 0), new Vector3(-0.0025, 0.0065, 0))
    .segment(new Vector3(0, 0.003, 0), new Vector3(0.0025, 0.0065, 0))
    .build(cursorMaterial);
  root.add(cursor);

  // ---- 構造体の配置(奥の左のパネル) ----
  const panel = { x: -0.19, top: 0.112, z: -0.105, line: 0.0105 } as const;
  root.add(
    new LineBuilder()
      .polyline([new Vector3(panel.x - 0.004, 0.06, panel.z), new Vector3(-0.02, 0.06, panel.z), new Vector3(-0.02, panel.top + 0.008, panel.z), new Vector3(panel.x - 0.004, panel.top + 0.008, panel.z)], true)
      .segment(new Vector3(panel.x - 0.004, 0, panel.z), new Vector3(panel.x - 0.004, 0.06, panel.z))
      .segment(new Vector3(-0.02, 0, panel.z), new Vector3(-0.02, 0.06, panel.z))
      .build(fader.line(PALETTE.gridMajor, 0.55)),
  );
  const structLines = ['struct Cube {', ...BLOCKS.map((b) => `  ${b.decl} // ${hex(BASE_ADDRESS + (b.cells[0] ?? 0) * CELL_BYTES)}`), '};'];
  const structLabels: Text[] = structLines.map((_, i) => {
    const label = standLabel(fader, '', panel.x, panel.top - i * panel.line, panel.z, { anchorX: 'left', anchorY: 'top', size: 0.0052 });
    root.add(label);
    return label;
  });

  // ---- 立方体: 頂点(点)、辺、面のハッチング、塗り ----
  const cube = new Group();
  root.add(cube);
  const vertexPositions = new BufferAttribute(new Float32Array(8 * 3), 3);
  vertexPositions.setUsage(DynamicDrawUsage);
  const vertexGeometry = new BufferGeometry();
  vertexGeometry.setAttribute('position', vertexPositions);
  const vertexMaterial = fader.add(new PointsMaterial({ color: PALETTE.glow, size: 0.0065, depthWrite: false }));
  const vertexPoints = new Points(vertexGeometry, vertexMaterial);
  vertexPoints.frustumCulled = false;
  root.add(vertexPoints);
  const edgeBuilder = new LineBuilder();
  for (const [a, b] of EDGES) edgeBuilder.segment(VERTICES[a] ?? new Vector3(), VERTICES[b] ?? new Vector3());
  const edgeMaterial = fader.line(PALETTE.glow, 1);
  const edgeLines = edgeBuilder.build(edgeMaterial);
  cube.add(edgeLines);
  const hatch = new LineBuilder();
  const HATCH = 6;
  for (const face of FACES) {
    const [p0, p1, , p3] = face.map((k) => VERTICES[k] ?? new Vector3());
    if (p0 === undefined || p1 === undefined || p3 === undefined) continue;
    const u = p1.clone().sub(p0);
    const v = p3.clone().sub(p0);
    // 面を 45° の斜線で埋める(正方形の中で切る)
    for (let k = 1; k < HATCH * 2; k++) {
      const s = k / HATCH;
      const a = s <= 1 ? p0.clone().addScaledVector(u, s) : p0.clone().add(u).addScaledVector(v, s - 1);
      const b = s <= 1 ? p0.clone().addScaledVector(v, s) : p0.clone().add(v).addScaledVector(u, s - 1);
      hatch.segment(a, b);
    }
  }
  const hatchMaterial = fader.line(PALETTE.ink, 0);
  const hatchLines = hatch.build(hatchMaterial);
  cube.add(hatchLines);
  const hatchVertices = hatchLines.geometry.getAttribute('position').count;
  const faceMaterial = fader.add(new MeshBasicMaterial({ color: PALETTE.floor, opacity: 0, depthWrite: false }));
  cube.add(new Mesh(new BoxGeometry(CUBE.half * 2, CUBE.half * 2, CUBE.half * 2), faceMaterial));

  // 着地の衝撃の輪と、影
  const X = new Vector3(1, 0, 0);
  const Z = new Vector3(0, 0, 1);
  const impactMaterial = fader.line(PALETTE.glow, 0);
  const impact = new LineBuilder().circle(new Vector3(), 1, X, Z, 48).build(impactMaterial);
  impact.position.set(CUBE.center.x, Y_INK, CUBE.center.z);
  root.add(impact);
  const shadowMaterial = fader.line(PALETTE.dim, 0);
  const shadow = new LineBuilder()
    .polyline([new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(1, 0, 1), new Vector3(-1, 0, 1)], true)
    .build(shadowMaterial);
  shadow.position.set(CUBE.center.x, Y_INK, CUBE.center.z);
  root.add(shadow);

  // ブロックから立方体への参照の線
  const refs = BLOCKS.map((block, k) => {
    const material = fader.line(k === 0 ? PALETTE.warm : PALETTE.cyan, 0);
    const line = new DynamicLine(2, material);
    root.add(line.line);
    const from = cellCenter(block.cells[Math.floor(block.cells.length / 2)] ?? 0, new Vector3());
    return { line, material, from };
  });

  const caption = standLabel(fader, 'new Cube()', CUBE.center.x, CUBE.half * 2 + 0.03, CUBE.center.z, { size: 0.0085, color: PALETTE.glow }, 0);
  const euler = standLabel(fader, 'V - E + F = 8 - 12 + 6 = 2', CUBE.center.x, CUBE.half * 2 + 0.018, CUBE.center.z, { size: 0.0055 }, 0);
  root.add(caption, euler);

  root.add(titleBlock(fader, 3, 'HEAP ALLOCATION', 'malloc x3 -> V, E, F -> SOLID'));

  const tmp = new Vector3();
  const color = new Color();
  return {
    root,
    fader,
    update(beat, ctx) {
      const pulse = beatPulse(ctx, 0.3);

      // ---- ヒープのセルの状態 ----
      cellState.forEach((state, i) => {
        if (beat >= state.at) {
          // 確保された瞬間に明るく光り、落ち着く
          color.copy(state.color).multiplyScalar(0.55 + 0.45 * Math.exp(-(beat - state.at) / 0.35));
        } else {
          color.copy(state.at === Infinity ? state.color : FREE);
        }
        fills.setColorAt(i, color);
      });
      if (fills.instanceColor !== null) fills.instanceColor.needsUpdate = true;

      // 確保の矢印は、次に確保するブロックの頭へ移る
      const next = BLOCKS.findIndex((b) => beat < b.at + 0.4);
      const target = BLOCKS[next < 0 ? BLOCKS.length - 1 : next];
      if (target !== undefined) {
        const prev = BLOCKS[Math.max(next - 1, 0)];
        const k = smoothstep(progress(beat, [target.at - 0.35, target.at]));
        const a = cellCenter(prev?.header ?? target.header, new Vector3());
        const b = cellCenter(target.header, new Vector3());
        cursor.position.copy(a.lerp(b, k)).setY(0.002);
      }
      fader.set(cursorMaterial, beat < 2.5 ? 0.9 : Math.max(0, 0.9 - (beat - 2.5) * 2));
      BLOCKS.forEach((block, k) => {
        fader.set(blockLabels[k] ?? caption, beat >= block.at ? 1 : 0);
      });

      // 構造体の宣言を、確保した順に打つ
      structLabels.forEach((label, i) => {
        const full = structLines[i] ?? '';
        const startAt = i === 0 ? 0.1 : i <= BLOCKS.length ? (BLOCKS[i - 1]?.at ?? 0) : 2.4;
        const typed = Math.floor(full.length * clamp01((beat - startAt) / 0.5));
        setText(label, full.slice(0, typed));
      });

      // ---- 立方体の位置(落下して着地) ----
      const drop = bounce(progress(beat, TIMING.drop));
      cube.position.set(CUBE.center.x, CUBE.center.y + (CUBE.half - CUBE.center.y) * drop, CUBE.center.z);

      // 頂点: 置かれる → 浮き上がって頂点の位置へ
      const vBlock = BLOCKS[0];
      for (let i = 0; i < 8; i++) {
        const cellA = vBlock.cells[0] ?? 0;
        const cellB = vBlock.cells.at(-1) ?? 0;
        const from = cellCenter(cellA, new Vector3()).lerp(cellCenter(cellB, tmp), i / 7).setY(0.004);
        const to = (VERTICES[i] ?? new Vector3()).clone().add(cube.position);
        const k = easeInOutCubic(progress(beat, [TIMING.rise(i), TIMING.rise(i) + TIMING.fly]));
        const p = from.lerp(to, k);
        vertexPositions.setXYZ(i, p.x, p.y + Math.sin(k * Math.PI) * 0.035, p.z);
      }
      vertexPositions.needsUpdate = true;
      vertexGeometry.setDrawRange(0, [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => beat >= TIMING.lay(i)).length);
      fader.set(vertexMaterial, 0.85 + 0.15 * pulse);

      const e = progress(beat, TIMING.edges);
      edgeLines.geometry.setDrawRange(0, Math.floor(e * EDGES.length) * 2);
      const f = progress(beat, TIMING.faces);
      hatchLines.geometry.setDrawRange(0, Math.floor((f * hatchVertices) / 2) * 2);
      fader.set(hatchMaterial, 0.55 * smoothstep(f));
      fader.set(faceMaterial, 0.12 * smoothstep(f));

      // 参照の線(使い始めたときに出す)
      const useAt = [TIMING.rise(0), TIMING.edges[0], TIMING.faces[0]];
      refs.forEach(({ line, material, from }, k) => {
        line.set(0, from.x, 0.002, from.z);
        line.set(1, cube.position.x, cube.position.y - CUBE.half, cube.position.z);
        line.commit(2);
        const on = smoothstep(progress(beat, [useAt[k] ?? 0, (useAt[k] ?? 0) + 0.4]));
        const off = 1 - smoothstep(progress(beat, [TIMING.drop[1], TIMING.drop[1] + 0.8]));
        fader.set(material, 0.45 * on * off);
      });

      // 着地: 衝撃の輪、影、題名
      const sinceLand = beat - TIMING.drop[1] + 0.25;
      impact.scale.setScalar(CUBE.half * 1.2 + Math.max(sinceLand, 0) * 0.05);
      fader.set(impactMaterial, sinceLand >= 0 ? Math.max(0, 0.8 - sinceLand * 0.9) : 0);
      const height = cube.position.y - CUBE.half;
      shadow.scale.setScalar(CUBE.half * (1 + height * 4));
      fader.set(shadowMaterial, beat >= TIMING.faces[0] ? 0.5 * (1 - clamp01(height / 0.06)) + 0.15 : 0);
      const cap = smoothstep(progress(beat, TIMING.caption));
      fader.set(caption, cap);
      fader.set(euler, cap * 0.9);
      edgeMaterial.color.set(beat >= TIMING.drop[1] ? PALETTE.warm : PALETTE.glow);
    },
  };
});
