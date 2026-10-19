# CLAUDE.md

Mili「world.execute(me);」の1番を、机の上の AR(WebXR `immersive-ar`)で再構成する映像作品のプロトタイプ。
概要・構成・コマンドは README.md を参照。

## 進め方

- 計画 → 確認 → 着手。不明点や決まっていないことは推測せず、質問する
- 頼まれた範囲だけを作業する。範囲の外で気づいたことは、手を付けずに提案する
- Issue がある作業は、PR の本文に `Closes #番号` を書く

## 守ること

- TypeScript は strict。`any` は使わない(oxlint で error)
- 時刻の基準は `audio.currentTime` だけ(音源が無いときだけ無音のタイマー)。シーンには `?latency=` で補正した時刻(`ctx.songTime`、`update` の `t`)が渡る
- 音楽に合わせるタイミングは、拍グリッド(`public/beats.json`)を基準に小節・拍で書く
- 歌詞と音源はリポジトリに入れない(著作物)。`public/audio/` と `tools/beats/out/` は gitignore 済み
- WebXR Device API だけを使う。Meta 専用の API・ライブラリは使わない(Android XR / XREAL への移植を前提にしている)
- 映像作品なので、再生が始まったあとの操作は作らない(許すのは起動時の操作だけ)。開発用の機能は URL パラメータ(`?t=` `?bar=` `?debug` など)で出す
- 3D のラベル(troika-three-text)は同梱の IBM Plex Mono(latin)なので、ASCII しか表示できない。式は `2*pi*f*t` のように書く
- ステージの単位はメートル、+Y が上、+Z が手前(観客側)。床は約 40cm × 30cm

## 動作確認

- `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build`
- デスクトップモードのスクリーンショット(`?bar=` か `?t=` と `?debug` を付ける)
- AR は、Immersive Web Emulator でセッション開始 → 原点確定 → 再生開始まで

### クラウド環境での確認

- headless Chromium(`/opt/pw-browsers/chromium`)を playwright-core で起動する。引数は `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`(音を鳴らすなら `--autoplay-policy=no-user-gesture-required` も)
	- playwright-core などの確認用のパッケージはリポジトリに入れず、scratchpad に入れる
- Immersive Web Emulator の拡張は取得できない(GitHub への直接アクセスが 403)。代わりに npm の `iwer` + `@iwer/sem` を使う
	- `new XRDevice(metaQuest3)` → `installRuntime({ forceInstall: true })` → `installSEM(SyntheticEnvironmentModule)` → DOMContentLoaded で `sem.loadEnvironment(<@iwer/sem/captures/office_small.json>)`
	- esbuild で `--bundle --format=iife --external:@drawcall/glts` にまとめ、Playwright の `addInitScript` で注入する
	- 頭を下に向ける: `device.quaternion.set(sin(-55°/2), 0, 0, cos(-55°/2))`
	- select を送る: `device.controllers.right.updateButtonValue('trigger', 1)` → 300ms 後に 0
	- iwer は DOM overlay を表示しないので、配置のヒントは確認できない
- Vite の開発サーバーは、存在しないファイルにも `200 text/html` を返す(音源の有無は `<audio>` の error で判定している)
- jsDelivr には繋がらない
