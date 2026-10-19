import type { SceneContext, SceneModule } from '../scenes/types';
import { entryAt, type Timeline, type TimelineEntry } from './timeline';

/** 再生位置に従って、タイムライン上のシーンを enter / update / exit する */
export class SceneManager {
  private readonly registry: ReadonlyMap<string, SceneModule>;
  private readonly timeline: Timeline;
  private readonly ctx: SceneContext;
  private current: { readonly entry: TimelineEntry; readonly scene: SceneModule } | null = null;

  constructor(registry: ReadonlyMap<string, SceneModule>, timeline: Timeline, ctx: SceneContext) {
    for (const entry of timeline) {
      if (!registry.has(entry.scene)) {
        throw new Error(`timeline.json: シーン "${entry.scene}" は登録されていません`);
      }
    }
    this.registry = registry;
    this.timeline = timeline;
    this.ctx = ctx;
  }

  get activeEntry(): TimelineEntry | null {
    return this.current?.entry ?? null;
  }

  update(songTime: number, dt: number): void {
    const entry = entryAt(this.timeline, songTime) ?? null;
    if (entry !== this.activeEntry) {
      this.stop();
      const scene = entry === null ? undefined : this.registry.get(entry.scene);
      if (entry !== null && scene !== undefined) {
        scene.enter(this.ctx);
        this.current = { entry, scene };
      }
    }
    if (this.current !== null) {
      this.current.scene.update(this.ctx, songTime - this.current.entry.start, dt);
    }
  }

  /** 表示中のシーンを exit する */
  stop(): void {
    this.current?.scene.exit(this.ctx);
    this.current = null;
  }
}
