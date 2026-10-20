import { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBeatGrid, type BeatGrid } from '../core/beats';
import { SceneManager } from '../core/sceneManager';
import { loadTimeline, timelineEnd, type Timeline } from '../core/timeline';
import { sceneRegistry } from './index';
import { TRANSITION_BEATS } from './kit';
import { StageBase } from './stageBase';
import type { SceneContext } from './types';

/**
 * 全シーンを実際の WebGL で描いてみる確認(vitest のブラウザーモード、headless Chromium)。
 * 見た目は確かめず、エラーが出ないこと・GPU の資源を残さないことだけを見る。
 */

/** 描いて進める間隔 [s] */
const STEP = 1 / 15;

let beats: BeatGrid;
let timeline: Timeline;
let end: number;
let transition: number;
let renderer: WebGLRenderer;
let scene: Scene;
let camera: PerspectiveCamera;
let stage: Group;
let songTime = 0;
let manager: SceneManager;
let stageBase: StageBase;
let errors: unknown[][];

const ctx: SceneContext = {
  get stage() {
    return stage;
  },
  get camera() {
    return camera;
  },
  get renderer() {
    return renderer;
  },
  get songTime() {
    return songTime;
  },
  get beats() {
    return beats;
  },
  get beat() {
    return beats.positionAt(songTime);
  },
};

/** main と同じ順で、1フレーム分進めて描く */
function frame(t: number, dt: number): void {
  songTime = t;
  manager.update(t, dt);
  stageBase.update(t);
  renderer.render(scene, camera);
}

/** 頭から終わりまで再生して、止めたあとに GPU に残っている数を返す */
function playThrough(): { geometries: number; textures: number } {
  for (let t = 0; t < end + transition + 1; t += STEP) {
    frame(t, STEP);
  }
  expect(manager.activeEntry).toBeNull();
  manager.stop();
  frame(end + 10, 0);
  return { ...renderer.info.memory };
}

function expectNoGlError(): void {
  expect(renderer.getContext().getError()).toBe(0);
}

beforeAll(async () => {
  // main と同じく public/ のものを読む
  beats = await loadBeatGrid('/beats.json');
  timeline = await loadTimeline('/timeline.json', beats);
  end = timelineEnd(timeline);
  transition = TRANSITION_BEATS * beats.secondsPerBeat;

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(320, 200, false);
  camera = new PerspectiveCamera(50, 320 / 200, 0.01, 20);
  camera.position.set(0, 0.45, 0.55);
  camera.lookAt(0, 0.05, 0);
});

afterAll(() => {
  renderer.dispose();
  renderer.domElement.remove();
});

beforeEach(() => {
  scene = new Scene();
  stage = new Group();
  scene.add(stage);
  songTime = 0;
  manager = new SceneManager(sceneRegistry, timeline, ctx, transition);
  stageBase = new StageBase(timeline, transition);
  stage.add(stageBase.root);
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  manager.stop();
  vi.restoreAllMocks();
});

describe('シーン(WebGL)', () => {
  it('全シーンを先にコンパイルできる', async () => {
    const warmup = new Group();
    for (const module of sceneRegistry.values()) {
      const root = module.warmup?.(ctx);
      if (root !== undefined) warmup.add(root);
    }
    expect(warmup.children.length).toBeGreaterThan(0);
    await renderer.compileAsync(warmup, camera, scene);
    expectNoGlError();
    expect(errors).toEqual([]);
  });

  it('頭から終わりまで再生しても、エラーを出さず、GPU の資源を残さない', () => {
    // 1回目で残るのは、出しっぱなしのもの(床の台紙、troika の文字のテクスチャ)だけのはず。
    // 2回目で増えていたら、シーンが作ったものを破棄し忘れている
    const first = playThrough();
    const second = playThrough();
    expect(second).toEqual(first);
    expectNoGlError();
    expect(errors).toEqual([]);
  });

  it('シークと巻き戻しを繰り返しても、エラーを出さない', () => {
    const spb = beats.secondsPerBeat;
    for (const entry of timeline) {
      const mid = (entry.start + entry.end) / 2;
      // 途中から入る → 少し進む → 頭に巻き戻す → 終わりの直後(クロスフェード中)へ飛ぶ → 少し戻る
      frame(mid, 0);
      for (let i = 1; i <= 8; i++) frame(mid + i * STEP, STEP);
      frame(entry.start, 0);
      frame(entry.end + transition / 2, 0);
      frame(entry.end - spb, 0);
      frame(entry.end + spb / 4, spb);
    }
    // 最初のシーンへ巻き戻して、作り直す
    const first = timeline[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    frame(first.start, 0);
    expect(manager.activeEntry).toBe(first);
    expectNoGlError();
    expect(errors).toEqual([]);
  });
});
