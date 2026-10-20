import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import { Color, Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { loadBeatGrid } from './core/beats';
import { loadStoredAudio, storeAudio } from './core/audioStore';
import { loadAudioClock, SilentClock, type PlaybackClock } from './core/clock';
import { DesktopView } from './core/desktop';
import { FpsMeter } from './core/fps';
import { BarMarker } from './core/marker';
import { createOriginMarker, createReticle } from './core/markers';
import { readLaunchParams } from './core/params';
import { SceneManager } from './core/sceneManager';
import { StartPanel } from './core/startPanel';
import { loadTimeline, timelineEnd } from './core/timeline';
import { ArOverlay, DebugHud, PlayOverlay, showFatal } from './core/ui';
import { ArStageController } from './core/xr';
import { sceneRegistry } from './scenes';
import { TRANSITION_BEATS } from './scenes/kit';
import { StageBase } from './scenes/stageBase';
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
  stage.scale.setScalar(params.scale);
  scene.add(stage);
  const originMarker = createOriginMarker();
  stage.add(originMarker);
  const reticle = createReticle();
  scene.add(reticle);

  const desktop = new DesktopView(camera, renderer.domElement);
  const hud = new DebugHud(params.debug);
  const fps = params.fps ? new FpsMeter(true) : null;

  const beats = await loadBeatGrid(`${BASE}beats.json`);
  const timeline = await loadTimeline(`${BASE}timeline.json`, beats);
  const duration = timelineEnd(timeline);
  const startTime = params.startBar === null ? params.startTime : Math.max(beats.timeOf(params.startBar), 0);
  // 音源: 開発サーバーでは public/audio/track.mp3 があればそれを使う。ビルドしたもの(公開用)には音源を入れないので、見る人に選んでもらう
  const bundled = import.meta.env.DEV ? await loadAudioClock(`${BASE}audio/track.mp3`) : null;
  let clock: PlaybackClock = bundled ?? new SilentClock(duration);
  clock.seek(startTime);
  let sourceWarning: string | null = null;
  /** 音源が決まった(または音源なしで見ると決めた)か。決まるまでは再生のボタンを出さない */
  let ready = false;

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
  // シーンの切り替えはクロスフェード。前のシーンを終わったあとも少し残す
  const transition = TRANSITION_BEATS * beats.secondsPerBeat;
  const manager = new SceneManager(sceneRegistry, timeline, ctx, transition);
  const stageBase = new StageBase(timeline, transition);
  stage.add(stageBase.root);

  // 全シーンを一度作り、シェーダーを先にコンパイルしておく(シーンに入った瞬間の引っかかりを防ぐ)。
  // three.js はマテリアルを破棄するとコンパイル済みのシェーダーも解放するので、作ったものは破棄しない
  const warmup = new Group();
  for (const module of sceneRegistry.values()) {
    const root = module.warmup?.(ctx);
    if (root !== undefined) warmup.add(root);
  }
  await renderer.compileAsync(warmup, camera, scene);

  // fps の表示は、デスクトップでは F キーで表示と非表示を切り替える
  if (fps !== null) {
    window.addEventListener('keydown', (event) => {
      if ((event.key === 'f' || event.key === 'F') && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) fps.toggle();
    });
  }

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
    panel?.setVisible(false);
    void startPlayback();
  }, false);

  // 再生中は操作なしの方針なので、終了ボタンは開発用(?debug)のときだけ出す
  const overlay = new ArOverlay(params.debug ? () => ar.endSession() : null);
  const ar = new ArStageController(renderer, stage, reticle, overlay, {
    onSessionStart: () => {
      desktop.suspend();
      scene.background = null;
      play.hide();
      panel?.setVisible(false);
      clock.pause();
      clock.seek(startTime);
      manager.stop();
      stage.visible = false;
      overlay.setHint('机の上を見回して、置きたい場所をタップ');
      hud.mount(overlay.root);
      fps?.mount(overlay.root);
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
      panel?.setVisible(true);
      hud.mount(document.body);
      fps?.mount(document.body);
    },
  }, params.scale);
  document.body.appendChild(ar.button);

  /** 音源が決まったら、再生のボタン(PLAY / START AR)を出す */
  const useClock = (next: PlaybackClock): void => {
    clock.pause();
    clock = next;
    clock.seek(startTime);
    sourceWarning = next.kind === 'audio' ? beats.checkSource(next.duration) : null;
    if (sourceWarning !== null) console.warn(sourceWarning);
    ready = true;
    play.show('PLAY');
    ar.button.style.visibility = '';
  };
  ar.button.style.visibility = 'hidden';

  let objectUrl: string | null = null;
  /** 見る人が選んだ(または前に選んだ)ファイルを音源にする */
  const useFile = async (file: File, restored: boolean): Promise<boolean> => {
    const url = URL.createObjectURL(file);
    const next = await loadAudioClock(url);
    if (next === null) {
      URL.revokeObjectURL(url);
      return false;
    }
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
    useClock(next);
    panel?.showChosen(file.name, next.duration, sourceWarning, restored);
    return true;
  };

  const panel = bundled === null
    ? new StartPanel({
        onFile: (file) => {
          void useFile(file, false).then((ok) => {
            if (ok) void storeAudio(file);
            else panel?.showError('このファイルは音源として読み込めませんでした。mp3 などの音声ファイルを選んでください');
          });
        },
        onSilent: () => {
          useClock(new SilentClock(duration));
          panel?.showSilent();
        },
      })
    : null;
  if (bundled !== null) {
    useClock(bundled);
  } else {
    const stored = await loadStoredAudio();
    if (stored !== null) await useFile(stored, true);
  }

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

    const frameStart = performance.now();
    const songTime = songTimeNow();
    const dt = Math.min(Math.max(songTime - prevSongTime, 0), 0.1);
    prevSongTime = songTime;
    manager.update(songTime, dt);
    const baseOpacity = stageBase.update(songTime);
    originMarker.visible = manager.activeEntry === null && baseOpacity === 0;

    if (renderer.xr.isPresenting) {
      // 映像作品なので、曲が終わったら AR も終える
      if (ar.isPlaced && clock.ended) ar.endSession();
    } else if (ready && clock.ended && !play.visible) {
      play.show('REPLAY');
      panel?.setVisible(true);
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
      ...(params.scale === 1 ? [] : [`scale  x${params.scale} (stage ${stage.scale.x.toFixed(2)})`]),
      ...(sourceWarning === null ? [] : [`warn   ${sourceWarning}`]),
      ...(marker?.hudLines() ?? []),
    ]);
    const sinceBeat = position.phase * beats.secondsPerBeat;
    hud.pulse(clock.playing ? Math.max(1 - sinceBeat / BEAT_FLASH, 0) : 0, position.beat === 1);

    const updated = performance.now();
    renderer.render(scene, camera);
    fps?.frame(updated, updated - frameStart, performance.now() - updated);
  });
}

main().catch(showFatal);
