import { describe, expect, it } from 'vitest';
import type { SceneContext, SceneModule } from '../scenes/types';
import { SceneManager } from './sceneManager';
import type { Timeline } from './timeline';

/** enter / update / exit の呼ばれ方を記録するシーン */
function recorder(id: string, log: string[]): SceneModule {
  return {
    id,
    enter: () => log.push(`enter ${id}`),
    update: (_ctx, t) => log.push(`update ${id} ${t.toFixed(1)}`),
    exit: () => log.push(`exit ${id}`),
  };
}

function setup(timeline: Timeline): { manager: SceneManager; log: string[] } {
  const log: string[] = [];
  const registry = new Map([recorder('a', log), recorder('b', log)].map((s) => [s.id, s]));
  // シーンは記録だけで ctx に触らない
  const ctx = {} as SceneContext;
  return { manager: new SceneManager(registry, timeline, ctx, 1), log };
}

const AB: Timeline = [
  { scene: 'a', start: 0, end: 10 },
  { scene: 'b', start: 10, end: 20 },
];

describe('SceneManager', () => {
  it('自然に次のシーンへ進むと、前のシーンを tail の間だけ残してから消す', () => {
    const { manager, log } = setup(AB);
    manager.update(9.9, 0);
    manager.update(10.2, 0);
    manager.update(11.1, 0);
    expect(log).toEqual(['enter a', 'update a 9.9', 'enter b', 'update a 10.2', 'update b 0.2', 'exit a', 'update b 1.1']);
    expect(manager.activeEntry?.scene).toBe('b');
  });

  it('シークで飛んだときは、前のシーンをすぐ消す', () => {
    const { manager, log } = setup(AB);
    manager.update(5, 0);
    manager.update(15, 0);
    expect(log).toEqual(['enter a', 'update a 5.0', 'exit a', 'enter b', 'update b 5.0']);
  });

  it('残している間に巻き戻すと、作り直す', () => {
    const { manager, log } = setup(AB);
    manager.update(9.9, 0);
    manager.update(10.5, 0);
    log.length = 0;
    manager.update(9, 0);
    expect(log).toEqual(['exit a', 'exit b', 'enter a', 'update a 9.0']);
  });

  it('次のシーンが無いときも、tail の間は残す', () => {
    const { manager, log } = setup([{ scene: 'a', start: 0, end: 10 }]);
    manager.update(9.9, 0);
    manager.update(10.5, 0);
    expect(manager.activeEntry).toBeNull();
    manager.update(11.5, 0);
    expect(log).toEqual(['enter a', 'update a 9.9', 'update a 10.5', 'exit a']);
  });

  it('stop で残しているシーンも含めて消す', () => {
    const { manager, log } = setup(AB);
    manager.update(9.9, 0);
    manager.update(10.2, 0);
    log.length = 0;
    manager.stop();
    expect(log).toEqual(['exit a', 'exit b']);
  });
});
