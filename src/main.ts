import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import { Color, Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createClock, SilentClock, type PlaybackClock } from './core/clock';
import { DesktopView } from './core/desktop';
import { createOriginMarker, createReticle } from './core/markers';
import { readLaunchParams } from './core/params';
import { SceneManager } from './core/sceneManager';
import { loadTimeline, timelineEnd } from './core/timeline';
import { ArOverlay, DebugHud, PlayOverlay, showFatal } from './core/ui';
import { ArStageController } from './core/xr';
import { sceneRegistry } from './scenes';
import type { SceneContext } from './scenes/types';

const DESKTOP_BACKGROUND = new Color(0x05070d);
const BASE = import.meta.env.BASE_URL;

async function main(): Promise<void> {
  const params = readLaunchParams(location.search);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = DESKTOP_BACKGROUND;
  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 20);

  const stage = new Group();
  stage.name = 'stage';
  scene.add(stage);
  const originMarker = createOriginMarker();
  stage.add(originMarker);
  const reticle = createReticle();
  scene.add(reticle);

  const desktop = new DesktopView(camera, renderer.domElement);
  const hud = new DebugHud(params.debug);

  const timeline = await loadTimeline(`${BASE}timeline.json`);
  const duration = timelineEnd(timeline);
  let clock: PlaybackClock = await createClock(`${BASE}audio/track.mp3`, duration);
  clock.seek(params.startTime);

  const ctx: SceneContext = {
    stage,
    camera,
    renderer,
    get songTime() {
      return clock.time;
    },
  };
  const manager = new SceneManager(sceneRegistry, timeline, ctx);

  const startPlayback = async (): Promise<void> => {
    try {
      await clock.play();
    } catch (error) {
      // 自動再生の制限などで音が出せなかったときは、無音のまま映像だけ進める
      console.warn('音源を再生できなかったため、無音で再生します', error);
      const silent = new SilentClock(duration);
      silent.seek(clock.time);
      clock = silent;
      await clock.play();
    }
  };

  const play = new PlayOverlay(() => {
    if (clock.ended) clock.seek(params.startTime);
    play.hide();
    void startPlayback();
  });

  const overlay = new ArOverlay(() => ar.endSession());
  const ar = new ArStageController(renderer, stage, reticle, overlay, {
    onSessionStart: () => {
      desktop.suspend();
      scene.background = null;
      play.hide();
      clock.pause();
      clock.seek(params.startTime);
      manager.stop();
      stage.visible = false;
      overlay.setHint('机の上を見回して、置きたい場所をタップ');
      hud.mount(overlay.root);
    },
    onPlaced: () => {
      stage.visible = true;
      overlay.setHint(null);
      void startPlayback();
    },
    onSessionEnd: () => {
      clock.pause();
      clock.seek(params.startTime);
      manager.stop();
      stage.visible = true;
      scene.background = DESKTOP_BACKGROUND;
      desktop.resume();
      resize();
      play.show('PLAY');
      hud.mount(document.body);
    },
  });
  document.body.appendChild(ar.button);

  const resize = (): void => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  let prevSongTime = clock.time;
  renderer.setAnimationLoop((_time: number, frame?: XRFrame) => {
    if (frame === undefined) {
      desktop.update();
    } else {
      ar.update(frame);
    }

    const songTime = clock.time;
    const dt = Math.min(Math.max(songTime - prevSongTime, 0), 0.1);
    prevSongTime = songTime;
    manager.update(songTime, dt);
    originMarker.visible = manager.activeEntry === null;

    if (!renderer.xr.isPresenting && clock.ended && !play.visible) {
      play.show('REPLAY');
    }

    const entry = manager.activeEntry;
    hud.update([
      `t      ${songTime.toFixed(2)} s`,
      `scene  ${entry === null ? '-' : `${entry.scene} (+${(songTime - entry.start).toFixed(2)} s)`}`,
      `clock  ${clock.kind}${clock.playing ? '' : ' (paused)'}`,
      `mode   ${renderer.xr.isPresenting ? `ar / stage ${ar.isPlaced ? 'placed' : 'searching'} / anchor ${ar.anchorState}` : 'desktop'}`,
    ]);

    renderer.render(scene, camera);
  });
}

main().catch(showFatal);
