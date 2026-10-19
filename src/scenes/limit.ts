import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineSegments, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { Fader, PALETTE, defineScene, floorLabel, progress, setText, standLabel } from './kit';

/**
 * #9 極限: 部分和 S_n = 1 + 1/4 + 1/9 + … の棒が増えていく。横軸は x = 1 − 1/n の目盛りで縮むので、
 * 無限個の棒が有限の幅に収まり、高さも π²/6 の漸近線に近づいて有限に収まる。2小節を想定。
 */

const X0 = -0.15;
const WIDTH = 0.3;
const Z = -0.02;
const HEIGHT = 0.11;
const LIMIT = Math.PI ** 2 / 6;
const MAX_TERMS = 800;
/** 棒の数が 1 → MAX_TERMS に増える区間 [拍](指数的に増える) */
const GROW: readonly [number, number] = [0.5, 6.5];

const xOf = (n: number): number => X0 + WIDTH * (1 - 1 / n);
const yOf = (s: number): number => (s / LIMIT) * HEIGHT;

export const limit = defineScene('limit', () => {
  const fader = new Fader();
  const root = new Group();

  // 部分和の棒(縦線)。あらかじめ全部作っておき、描く本数を増やしていく
  const array = new Float32Array(MAX_TERMS * 6);
  let sum = 0;
  const sums: number[] = [];
  for (let n = 1; n <= MAX_TERMS; n++) {
    sum += 1 / (n * n);
    sums.push(sum);
    array.set([xOf(n), 0, Z, xOf(n), yOf(sum), Z], (n - 1) * 6);
  }
  const attribute = new BufferAttribute(array, 3);
  attribute.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attribute);
  geometry.setDrawRange(0, 0);
  const bars = new LineSegments(geometry, fader.line(PALETTE.glow, 0.85));
  root.add(bars);

  // 横軸と目盛り(1, 2, 3, 5, 10, 100, ∞)、漸近線
  const axis = new LineBuilder().segment(new Vector3(X0 - 0.01, 0.0008, Z), new Vector3(X0 + WIDTH + 0.01, 0.0008, Z));
  const ticks: readonly [number, string][] = [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [10, '10'], [100, '100'], [Infinity, 'inf']];
  for (const [n, text] of ticks) {
    const x = n === Infinity ? X0 + WIDTH : xOf(n);
    axis.segment(new Vector3(x, 0.0008, Z), new Vector3(x, 0.0008, Z + 0.006));
    root.add(floorLabel(fader, text, x, Z + 0.014, { size: 0.005 }));
  }
  root.add(axis.build(fader.line(PALETTE.ink, 0.8)));
  const asymptote = new LineBuilder();
  for (let x = X0 - 0.01; x < X0 + WIDTH + 0.01; x += 0.008) {
    asymptote.segment(new Vector3(x, HEIGHT, Z), new Vector3(x + 0.004, HEIGHT, Z));
  }
  root.add(asymptote.build(fader.line(PALETTE.warm, 0.8)));
  root.add(standLabel(fader, 'pi^2/6 = 1.6449...', X0 + WIDTH + 0.012, HEIGHT, Z, { anchorX: 'left', size: 0.0055, color: PALETTE.warm }));
  root.add(standLabel(fader, 'S_n = 1 + 1/4 + 1/9 + ... + 1/n^2', X0, HEIGHT + 0.018, Z, { anchorX: 'left', size: 0.0065 }));
  const readout = standLabel(fader, '', X0, HEIGHT + 0.008, Z, { anchorX: 'left', size: 0.0058, color: PALETTE.glow });
  root.add(readout);

  return {
    root,
    fader,
    update(beat) {
      const n = Math.max(1, Math.floor(Math.exp(Math.log(MAX_TERMS) * progress(beat, GROW))));
      geometry.setDrawRange(0, beat >= GROW[0] ? n * 2 : 0);
      const s = sums[n - 1] ?? LIMIT;
      setText(readout, beat >= GROW[0] ? `n = ${n}   S_n = ${s.toFixed(4)}` : '');
    },
  };
});
