import type { SceneContext, SceneModule } from '../scenes/types';
import { entryAt, type Timeline, type TimelineEntry } from './timeline';

interface Running {
  readonly entry: TimelineEntry;
  readonly scene: SceneModule;
}

/**
 * 再生位置に従って、タイムライン上のシーンを enter / update / exit する。
 * シーンが終わったあとも tail 秒だけ残して update を続け、次のシーンとクロスフェードさせる(フェード自体は各シーンが行う)。
 */
export class SceneManager {
  private readonly registry: ReadonlyMap<string, SceneModule>;
  private readonly timeline: Timeline;
  private readonly ctx: SceneContext;
  private readonly tail: number;
  private current: Running | null = null;
  /** 終わったあと、tail の間だけ残しているシーン */
  private outgoing: Running | null = null;

  /** @param tail シーンが終わってから消すまでの時間 [s] */
  constructor(registry: ReadonlyMap<string, SceneModule>, timeline: Timeline, ctx: SceneContext, tail: number) {
    for (const entry of timeline) {
      if (!registry.has(entry.scene)) {
        throw new Error(`timeline.json: シーン "${entry.scene}" は登録されていません`);
      }
    }
    this.registry = registry;
    this.timeline = timeline;
    this.ctx = ctx;
    this.tail = tail;
  }

  get activeEntry(): TimelineEntry | null {
    return this.current?.entry ?? null;
  }

  update(songTime: number, dt: number): void {
    // 残しているシーンは、tail を過ぎたか、巻き戻されて終わる前に戻ったら消す
    if (this.outgoing !== null && (songTime >= this.outgoing.entry.end + this.tail || songTime < this.outgoing.entry.end)) {
      this.exit(this.outgoing);
      this.outgoing = null;
    }

    const entry = entryAt(this.timeline, songTime) ?? null;
    if (entry !== this.activeEntry) {
      const next = entry === null ? undefined : this.registry.get(entry.scene);
      if (this.current !== null) {
        const ended = this.current;
        this.current = null;
        // 再生が自然に end を越えたときだけ残す(シークで飛んだときや、次が同じシーンのときはすぐ消す)
        const natural = songTime >= ended.entry.end && songTime < ended.entry.end + this.tail;
        if (natural && ended.scene !== next) {
          if (this.outgoing !== null) this.exit(this.outgoing);
          this.outgoing = ended;
        } else {
          this.exit(ended);
        }
      }
      if (this.outgoing !== null && this.outgoing.scene === next) {
        this.exit(this.outgoing);
        this.outgoing = null;
      }
      if (entry !== null && next !== undefined) {
        next.enter(this.ctx, entry.end - entry.start);
        this.current = { entry, scene: next };
      }
    }

    for (const running of [this.outgoing, this.current]) {
      running?.scene.update(this.ctx, songTime - running.entry.start, dt);
    }
  }

  /** 表示中のシーンをすべて exit する */
  stop(): void {
    for (const running of [this.outgoing, this.current]) {
      if (running !== null) this.exit(running);
    }
    this.outgoing = null;
    this.current = null;
  }

  private exit(running: Running): void {
    running.scene.exit(this.ctx);
  }
}
