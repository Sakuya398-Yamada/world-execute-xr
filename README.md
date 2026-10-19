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

### URL パラメータ

| パラメータ | 内容 |
| --- | --- |
| `?t=45` | 再生開始位置 [秒]。シーンの確認用 |
| `?debug` | 再生位置・シーン名・AR の状態を左上に表示 |

例: `http://localhost:5173/?t=45&debug`

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

### チェック

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint(any は禁止)
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
	audio/track.mp3       音源(各自で配置、コミットしない)
src/
	main.ts               起動とレンダーループ
	core/                 再生クロック、タイムライン、シーン切替、デスクトップモード、AR(hit-test / anchor)、DOM の UI
	scenes/               シーン(1ファイル1シーン)と、その登録(index.ts)
	sim/                  回路の計算など、three.js に依存しない計算
	gfx/                  線と文字の描画ヘルパー
	types/                型定義が無い / 使えないライブラリの型
```

### タイムライン

`public/timeline.json` に、曲の再生位置(秒)でシーンを並べる。区間は重ねられない。

```json
[
  { "scene": "rectifier", "start": 45.0, "end": 58.0 }
]
```

どのシーンにも入らない時間は、ステージ原点に小さな十字だけを表示する。

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

## シーン一覧

### rectifier(AC → DC)

ブループリントの床(約 40cm × 30cm)の上に、ブリッジ全波整流回路をワイヤーフレームで立ち上げる。

- 0〜3 秒: 床が現れ、回路図が描かれ、部品が床から立ち上がる
- 3〜7 秒: IN のパネルに正弦波、OUT のパネルに全波整流の脈流。導通しているダイオード(D1/D3 ↔ D2/D4)が光る
- 7 秒: スイッチが閉じてコンデンサが入り、充電の過渡を経て直流に均される(元の脈流は薄く残す)

波形は `src/sim/bridgeRectifier.ts` で回路方程式から毎フレーム計算している。R・C・周波数・コンデンサが入る時刻などの定数は `src/scenes/rectifier.ts` の先頭にまとめてあり、後で歌に合わせて調整する。
