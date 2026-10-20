import { describe, expect, it } from 'vitest';
import { breadthFirst, carveMaze, isOpen, meetInMiddle } from './maze';

describe('maze', () => {
  const maze = carveMaze(15, 11, 16);
  const n = 15 * 11;

  it('完全迷路: 通路の数はマス数 − 1 で、すべてのマスに届く', () => {
    const edges = maze.open.reduce((sum, list) => sum + list.length, 0) / 2;
    expect(edges).toBe(n - 1);
    const { dist } = breadthFirst(maze, 0);
    expect(dist.every((d) => Number.isFinite(d))).toBe(true);
  });

  it('通路は隣どうしだけで、向きによらない', () => {
    maze.open.forEach((list, c) => {
      for (const d of list) {
        const dx = Math.abs((c % 15) - (d % 15));
        const dy = Math.abs(Math.floor(c / 15) - Math.floor(d / 15));
        expect(dx + dy).toBe(1);
        expect(isOpen(maze, d, c)).toBe(true);
      }
    });
  });

  it('同じ種なら同じ迷路', () => {
    expect(carveMaze(15, 11, 16).open).toEqual(maze.open);
    expect(carveMaze(15, 11, 17).open).not.toEqual(maze.open);
  });

  it('両端からの探索は、最短路の真ん中あたりで出会う', () => {
    const a = 0;
    const b = n - 1;
    const fromA = breadthFirst(maze, a);
    const fromB = breadthFirst(maze, b);
    const meeting = meetInMiddle(maze, fromA, fromB);
    const length = fromA.dist[b] ?? 0;
    expect(meeting.path).toHaveLength(length + 1);
    expect(meeting.path[0]).toBe(a);
    expect(meeting.path[meeting.path.length - 1]).toBe(b);
    expect(meeting.path[meeting.meetIndex]).toBe(meeting.cell);
    expect(meeting.step).toBe(Math.ceil(length / 2));
    // 隣り合うマスが通路でつながっている
    for (let i = 1; i < meeting.path.length; i++) {
      expect(isOpen(maze, meeting.path[i - 1] ?? -1, meeting.path[i] ?? -1)).toBe(true);
    }
  });
});
