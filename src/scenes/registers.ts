import { Group, Vector3 } from 'three';
import { LineBuilder } from '../gfx/lines';
import { seededRandom } from '../sim/random';
import { Fader, PALETTE, defineScene, progress, setText, standLabel } from './kit';

/**
 * #4 初期化: 宙に浮くパラメータのレジスタ。値がランダムに回り、拍ごとに1つずつ確定していく。
 * 2小節を想定。値は rectifier の回路定数など、この作品の中で実際に使うもの。
 */

const ROWS = [
  { name: 'V_p ', value: '10.0' },
  { name: 'f   ', value: '1.083' },
  { name: 'R   ', value: '1000' },
  { name: 'C   ', value: '0.006' },
  { name: 'dt  ', value: '0.001' },
  { name: 'seed', value: '0x2A' },
] as const;
/** i 行目が確定する拍 */
const lockAt = (i: number): number => 1.5 + i;
/** 値が回る速さ [回/拍] */
const SPIN_RATE = 6;
const PANEL = { x: -0.07, y0: 0.03, z: -0.03, rowHeight: 0.013, width: 0.15 } as const;

/** 確定値と同じ形(桁数・小数点・0x)のランダムな値 */
function scramble(value: string, random: () => number): string {
  const hex = value.startsWith('0x');
  return value.replace(/[0-9A-F]/g, (ch, offset: number) =>
    hex && offset < 2 ? ch : (hex ? '0123456789ABCDEF' : '0123456789')[Math.floor(random() * (hex ? 16 : 10))] ?? ch,
  );
}

export const registers = defineScene('registers', () => {
  const fader = new Fader();
  const root = new Group();

  const top = PANEL.y0 + (ROWS.length + 1) * PANEL.rowHeight;
  const frame = new LineBuilder()
    .polyline(
      [
        new Vector3(PANEL.x - 0.01, PANEL.y0 - 0.008, PANEL.z),
        new Vector3(PANEL.x + PANEL.width, PANEL.y0 - 0.008, PANEL.z),
        new Vector3(PANEL.x + PANEL.width, top + 0.008, PANEL.z),
        new Vector3(PANEL.x - 0.01, top + 0.008, PANEL.z),
      ],
      true,
    )
    .segment(new Vector3(PANEL.x - 0.01, 0, PANEL.z), new Vector3(PANEL.x - 0.01, PANEL.y0 - 0.008, PANEL.z))
    .segment(new Vector3(PANEL.x + PANEL.width, 0, PANEL.z), new Vector3(PANEL.x + PANEL.width, PANEL.y0 - 0.008, PANEL.z));
  root.add(frame.build(fader.line(PALETTE.gridMajor, 0.5)));
  root.add(standLabel(fader, 'params = {', PANEL.x, top, PANEL.z, { anchorX: 'left', size: 0.0065 }));
  root.add(standLabel(fader, '}', PANEL.x, PANEL.y0, PANEL.z, { anchorX: 'left', size: 0.0065 }));

  const rows = ROWS.map((row, i) => {
    const y = top - (i + 1) * PANEL.rowHeight;
    root.add(standLabel(fader, `  ${row.name} =`, PANEL.x, y, PANEL.z, { anchorX: 'left', size: 0.0065 }));
    const value = standLabel(fader, row.value, PANEL.x + 0.07, y, PANEL.z, { anchorX: 'left', size: 0.0065, color: PALETTE.glow });
    root.add(value);
    return { value, y };
  });

  // 確定させる行を指すカーソル
  const cursor = new LineBuilder()
    .segment(new Vector3(-0.006, 0, 0), new Vector3(0, 0, 0))
    .segment(new Vector3(-0.009, 0.003, 0), new Vector3(-0.006, 0, 0))
    .segment(new Vector3(-0.009, -0.003, 0), new Vector3(-0.006, 0, 0))
    .build(fader.line(PALETTE.warm, 1));
  root.add(cursor);

  return {
    root,
    fader,
    update(beat) {
      // 同じ拍の位置では同じ値になるよう、時刻から乱数の種を決める
      const random = seededRandom(Math.floor(beat * SPIN_RATE));
      rows.forEach(({ value }, i) => {
        const row = ROWS[i];
        if (row === undefined) return;
        const locked = beat >= lockAt(i);
        setText(value, locked ? row.value : scramble(row.value, random));
        value.color = locked ? (beat - lockAt(i) < 0.5 ? PALETTE.warm : PALETTE.label) : PALETTE.glow;
      });

      // カーソルは、次に確定する行へ1拍前に移る
      const next = Math.min(Math.max(Math.floor(beat - 0.5), 0), ROWS.length - 1);
      const k = progress(beat, [next + 0.5, next + 0.8]);
      const from = rows[Math.max(next - 1, 0)]?.y ?? 0;
      const to = rows[next]?.y ?? 0;
      cursor.position.set(PANEL.x - 0.004, from + (to - from) * k, PANEL.z);
      cursor.visible = beat < lockAt(ROWS.length - 1) + 0.5;
    },
  };
});
