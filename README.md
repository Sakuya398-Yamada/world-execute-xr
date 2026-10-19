# world-execute-xr

Mili「world.execute(me);」の1番を、机の上の AR(WebXR `immersive-ar`)として再構成するプロトタイプ。
歌詞ごとに数学・電気のモチーフを机の上に立ち上げる映像作品で、MV の再現ではなく、歌詞の構造を XR に翻訳することを目指している。

- Vite + TypeScript(strict)+ three.js + troika-three-text
- WebXR Device API のみ使用(Meta 専用の API・ライブラリは使わない。Android XR / XREAL Aura への移植を前提にしている)

## セットアップ

Node.js 20.19 以上 / 22.12 以上が必要。

```sh
npm install
npm run dev
```

`http://localhost:5173` を開くとデスクトップモードで表示される。

### 音源

`public/audio/track.mp3` に音源を置く。著作物なのでリポジトリには含めない(`.gitignore` 済み)。
音源が無い場合は、無音のタイマーで再生位置だけが進む。

拍のタイミング(`public/beats.json`)はこの音源を解析して作っている。配信版と MV 版のように、イントロなどが違う音源を置くと拍がずれる。
音源の長さが解析した音源と 0.05 秒以上違うと、コンソールと `?debug` の表示に警告が出る。

### URL パラメータ

| パラメータ | 内容 |
| --- | --- |
| `?t=45` | 再生開始位置 [秒]。シーンの確認用 |
| `?bar=25` | 再生開始位置 [小節]。`?t=` より優先 |
| `?latency=150` | 音の出力の遅れ [ms]。映像をこの分だけ遅らせる(下記) |
| `?debug` | 再生位置・小節.拍・シーン名・AR の状態を左上に表示し、拍ごとに光らせる(小節の1拍目はオレンジ)。AR 中の終了ボタン(×)もこのときだけ出す |

例: `http://localhost:5173/?bar=25&debug`

`audio.currentTime` は、実際に耳に届いている位置より少し先に進む。有線のスピーカーやイヤホンなら気にならないが、Bluetooth イヤホンだと 100ms を超えることが多い。
`?debug` で表示が拍に合わせて光るので、音とずれて見えるときは `?latency=` で合わせる。

## 開発

### デスクトップモード

XR 非対応の環境、および XR セッションの外では、同じシーンを OrbitControls で表示する(ドラッグで回転、ホイールでズーム)。
自動再生の制限があるので、音を出すには「> PLAY」を1回クリックする。再生が始まったあとの操作はない。

### Immersive Web Emulator

1. Chrome に [Immersive Web Emulator](https://chromewebstore.google.com/detail/cgffilbpcibhmcfbgggfhfolhkfbhmik) を入れる
2. 開発サーバーのページを開くと、下部のボタンが「START AR」になる
3. エミュレーターの操作パネル(DevTools の「WebXR」タブ。バージョンによってはページ上に出る)で、デバイス(Meta Quest 3 など)と部屋の環境を選ぶ。hit-test はこの環境のジオメトリに対して行われる
4. 「START AR」を押し、ヘッドセットを机か床に向けてレティクル(白い輪)を出す
5. コントローラーのトリガーでタップ(select)を送ると、その位置がステージ原点になり再生が始まる
6. 曲が終わると AR セッションも自動で終わる。途中で終えたいときは `?debug` を付けて開くと、右上に終了ボタン(×)が出る

### チェック

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint(any は禁止)
npm run test        # vitest(拍の計算、タイムラインの読み込みなど)
npm run build       # 型チェック + 本番ビルド
```

TypeScript 7 は typescript-eslint に未対応なので、lint には oxlint を使っている。

## スマホ(Android)での検証

前提: Android 端末に Chrome と「Google Play 開発者サービス(AR)」(ARCore)が入っていて、USB デバッグが有効になっていること。

1. PC で `npm run dev`(中身は `vite --host`)を起動する
2. 端末を USB で PC につなぎ、PC の Chrome で `chrome://inspect` を開く
3. 「Port forwarding...」で `5173` → `localhost:5173` を追加し、「Enable port forwarding」にチェックを入れる
4. 端末の Chrome で `http://localhost:5173` を開く(localhost はセキュアコンテキストなので WebXR が使える)
5. 「START AR」→ 机の上を見回してレティクルを出す → 置きたい場所をタップ

### 代替: HTTPS で起動する

USB をつながずに LAN 内から開く場合は、自己署名証明書で HTTPS 起動する(`@vitejs/plugin-basic-ssl`)。

```sh
npm run dev:https
```

端末の Chrome で `https://<PC の LAN 内 IP>:5173` を開き、証明書の警告を許可して進む。

## 構成

```
public/
	timeline.json         シーンのタイムライン
	beats.json            拍グリッド(tools/beats で音源を解析して作る)
	audio/track.mp3       音源(各自で配置、コミットしない)
src/
	main.ts               起動とレンダーループ
	core/                 再生クロック、拍グリッド、タイムライン、シーン切替、デスクトップモード、AR(hit-test / anchor)、DOM の UI
	scenes/               シーン(1ファイル1シーン)と、その登録(index.ts)
	sim/                  回路の計算など、three.js に依存しない計算
	gfx/                  線と文字の描画ヘルパー
	types/                型定義が無い / 使えないライブラリの型
tools/
	beats/                音源の拍を解析する開発用ツール(Python + librosa)
```

### タイムライン

`public/timeline.json` にシーンを並べる。`start` / `end` は小節(`{ "bar": 25 }`、拍まで指定するなら `{ "bar": 25, "beat": 3 }`)か、秒(数値)で書く。区間は重ねられない。

```json
[
  { "scene": "rectifier", "start": { "bar": 25 }, "end": { "bar": 32 } }
]
```

テンポが一定の曲なので、小節で書いておけば拍からずれない。どのシーンにも入らない時間は、ステージ原点に小さな十字だけを表示する。

### 拍グリッド

曲のテンポは一定(130 BPM)なので、拍の時刻を `offset + n × 60 / bpm` の直線で表している。中身は `public/beats.json`(数値だけで、音源や歌詞は含まない)。

| キー | 内容 |
| --- | --- |
| `bpm` | テンポ |
| `offset` | 拍 0 の時刻 [秒](0 以上、1拍の長さ未満) |
| `beatsPerBar` | 1小節の拍数 |
| `downbeat` | 曲で最初の下拍(1小節目の1拍目)になる拍の番号(0〜3) |
| `source.duration` | 解析した音源の長さ [秒]。再生する音源が同じものか確かめるのに使う |

小節は、曲で最初の下拍を 1 小節目として数える。それより前(曲の頭の 0.27 秒)は 0 小節目。

#### 作り直すとき

[uv](https://docs.astral.sh/uv/) が必要(Python と librosa は uv が用意する)。リポジトリのルートで実行する。

```sh
# 1拍目の候補(拍の番号 mod 4 = 0〜3)ごとに、曲にクリックを重ねた 30 秒の抜粋を tools/beats/out/ に出す
# 高いクリックが1拍目。小節の頭で高い音が鳴っているものを選ぶ。推定した候補も表示される(参考)
npm run beats -- candidates public/audio/track.mp3

# 拍を解析して public/beats.json を書く(--downbeat は上で選んだ番号)
npm run beats -- analyze public/audio/track.mp3 --downbeat 0

# beats.json の拍を曲全体に重ねた wav を tools/beats/out/click.wav に出す(耳での確認用)
npm run beats -- click public/audio/track.mp3
```

- librosa の既定の設定だと拍が最大 350ms ほどずれたので、時間分解能(hop 128)と拍の等間隔さ(tightness 400)を上げている
- 直線は 0.5〜200 秒の拍に当てはめる(冒頭の誤検出と、終盤のフェードアウトを避けるため)。今の音源ではずれが RMS 11.5ms、最大 71ms
- `tools/beats/out/` は音源を含むのでコミットしない(`.gitignore` 済み)

### シーン

`src/scenes/*.ts` に1ファイル1シーンで置き、`src/scenes/index.ts` に登録する。

```ts
interface SceneModule {
  readonly id: string; // timeline.json の scene と一致させる
  enter(ctx: SceneContext): void;
  update(ctx: SceneContext, t: number, dt: number): void; // t はシーン開始からの経過秒
  exit(ctx: SceneContext): void;
}
```

オブジェクトは `ctx.stage`(ステージ原点)の子に置く。単位はメートルで、+Y が上、+Z が手前(観客側)。

拍に合わせるときは `ctx.beats`(拍グリッド。`secondsPerBeat`、`timeOf(bar, beat)` など)と `ctx.beat`(今の `bar` / `beat` / 拍の中の位置 `phase`)を使う。
タイムラインを小節で書いたシーンは小節の頭から始まるので、`t / ctx.beats.secondsPerBeat` がシーン開始からの拍数になる。

## シーン一覧

### rectifier(AC → DC)

ブループリントの床(約 40cm × 30cm)の上に、ブリッジ全波整流回路をワイヤーフレームで立ち上げる。タイムラインでは 25〜32 小節目(約 44.6〜57.5 秒)。

- 最初の2小節: 床が現れ、回路図が描かれ、部品が床から立ち上がり、波形のパネルが出る
- 続く2小節: IN のパネルに正弦波(2拍で1周期)、OUT のパネルに全波整流の脈流。導通しているダイオード(D1/D3 ↔ D2/D4)が光る
- 5 小節目の頭(シーン開始から 16 拍): スイッチが閉じてコンデンサが入り、充電の過渡を経て直流に均される(元の脈流は薄く残す)

波形は `src/sim/bridgeRectifier.ts` で回路方程式から毎フレーム計算している。R・C・周波数・コンデンサが入る拍などの定数は `src/scenes/rectifier.ts` の先頭にまとめてあり、後で歌に合わせて調整する。
