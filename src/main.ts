import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import { Color, Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { loadBeatGrid } from './core/beats';
import { createClock, SilentClock, type PlaybackClock } from './core/clock';
import { DesktopView } from './core/desktop';
import { BarMarker } from './core/marker';
import { createOriginMarker, createReticle } from './core/markers';
import { readLaunchParams } from './core/params';
import { SceneManager } from './core/sceneManager';
import { loadTimeline, timelineEnd } from './core/timeline';
import { ArOverlay, DebugHud, PlayOverlay, showFatal } from './core/ui';
import { ArStageController } from './core/xr';
import { sceneRegistry } from './scenes';
import type { SceneContext } from './scenes/types';

const DESKTOP_BACKGROUND = new Color(0x05070d);
/** `?debug` の HUD が拍の頭で光っている時間 [s] */
const BEAT_FLASH = 0.15;
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

  const beats = await loadBeatGrid(`${BASE}beats.json`);
  const timeline = await loadTimeline(`${BASE}timeline.json`, beats);
  const duration = timelineEnd(timeline);
  const startTime = params.startBar === null ? params.startTime : Math.max(beats.timeOf(params.startBar), 0);
  let clock: PlaybackClock = await createClock(`${BASE}audio/track.mp3`, duration);
  clock.seek(startTime);

  const sourceWarning = clock.kind === 'audio' ? beats.checkSource(clock.duration) : null;
  if (sourceWarning !== null) {
    console.warn(sourceWarning);
  }

  /** 映像の時刻。音の出力の遅れの分だけ、再生位置より遅らせる */
  const songTimeNow = (): number => Math.max(clock.time - params.latency, 0);

  const ctx: SceneContext = {
    stage,
    camera,
    renderer,
    get songTime() {
      return songTimeNow();
    },
    beats,
    get beat() {
      return beats.positionAt(songTimeNow());
    },
  };
  const manager = new SceneManager(sceneRegistry, timeline, ctx);

  // 開発用: 歌詞に合わせてキーを押し、小節を記録する(timeline.json の下書き用)
  const marker = params.debug ? new BarMarker(beats, songTimeNow, (t) => clock.seek(Math.max(t + params.latency, 0))) : null;
  if (marker !== null) {
    window.addEventListener('keydown', marker.onKeyDown);
  }

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
    if (clock.ended) clock.seek(startTime);
    play.hide();
    void startPlayback();
  });

  // 再生中は操作なしの方針なので、終了ボタンは開発用(?debug)のときだけ出す
  const overlay = new ArOverlay(params.debug ? () => ar.endSession() : null);
  const ar = new ArStageController(renderer, stage, reticle, overlay, {
    onSessionStart: () => {
      desktop.suspend();
      scene.background = null;
      play.hide();
      clock.pause();
      clock.seek(startTime);
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
      clock.seek(startTime);
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

  let prevSongTime = songTimeNow();
  renderer.setAnimationLoop((_time: number, frame?: XRFrame) => {
    if (frame === undefined) {
      desktop.update();
    } else {
      ar.update(frame);
    }

    const songTime = songTimeNow();
    const dt = Math.min(Math.max(songTime - prevSongTime, 0), 0.1);
    prevSongTime = songTime;
    manager.update(songTime, dt);
    originMarker.visible = manager.activeEntry === null;

    if (renderer.xr.isPresenting) {
      // 映像作品なので、曲が終わったら AR も終える
      if (ar.isPlaced && clock.ended) ar.endSession();
    } else if (clock.ended && !play.visible) {
      play.show('REPLAY');
    }

    const entry = manager.activeEntry;
    const position = beats.positionAt(songTime);
    hud.update([
      `t      ${songTime.toFixed(2)} s`,
      `bar    ${position.bar}.${position.beat}  (${beats.bpm} BPM)`,
      `scene  ${entry === null ? '-' : `${entry.scene} (+${(songTime - entry.start).toFixed(2)} s)`}`,
      `clock  ${clock.kind}${clock.playing ? '' : ' (paused)'}`,
      `mode   ${renderer.xr.isPresenting ? `ar / stage ${ar.isPlaced ? 'placed' : 'searching'} / anchor ${ar.anchorState}` : 'desktop'}`,
      ...(params.latency === 0 ? [] : [`latency ${Math.round(params.latency * 1000)} ms`]),
      ...(sourceWarning === null ? [] : [`warn   ${sourceWarning}`]),
      ...(marker?.hudLines() ?? []),
    ]);
    const sinceBeat = position.phase * beats.secondsPerBeat;
    hud.pulse(clock.playing ? Math.max(1 - sinceBeat / BEAT_FLASH, 0) : 0, position.beat === 1);

    renderer.render(scene, camera);
  });
}

main().catch(showFatal);
