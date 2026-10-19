"""音源の拍グリッドを解析する開発用ツール。

テンポが一定の曲を前提に、librosa で検出した拍の時刻に直線(拍の時刻 = offset + n * 60 / bpm)を当てはめる。
書き出す beats.json は数値だけで、音源や歌詞は含まない。

リポジトリのルートで実行する:

    npm run beats -- candidates public/audio/track.mp3            # 1拍目の聴き比べ用の抜粋を 4 本出す
    npm run beats -- analyze public/audio/track.mp3 --downbeat 1  # public/beats.json を書く
    npm run beats -- click public/audio/track.mp3                 # beats.json の拍を曲に重ねた wav を出す
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent / "out"
DEFAULT_BEATS_JSON = ROOT / "public" / "beats.json"

# librosa の既定の設定だと拍が最大 350ms ほどずれたので、時間分解能と拍の等間隔さを上げている
ANALYSIS_SR = 22050
HOP_LENGTH = 128  # 約 5.8ms
TIGHTNESS = 400
# 直線を当てはめる区間 [s] の既定値。冒頭の誤検出と、終盤のフェードアウトを避ける
FIT_RANGE = (0.5, 200.0)
# 当てはめた BPM と最寄りの整数との差がこれ未満なら、整数に丸める(200 秒で 15ms ほどのずれに収まる)
BPM_SNAP = 0.01
# 残差がこれを超えた拍を外れ値として表示する [s]
OUTLIER = 0.05
BEATS_PER_BAR = 4
CANDIDATE_LENGTH = 30.0


@dataclass(frozen=True)
class Grid:
    bpm: float
    # 拍 0 の時刻 [s]。0 <= offset < 1拍の長さ
    offset: float

    @property
    def period(self) -> float:
        return 60.0 / self.bpm

    def beat_times(self, start: float, end: float) -> tuple[np.ndarray, np.ndarray]:
        """start <= t < end にある拍の (通し番号, 時刻)"""
        first = max(int(np.ceil((start - self.offset) / self.period)), 0)
        last = int(np.ceil((end - self.offset) / self.period))
        index = np.arange(first, max(last, first))
        return index, self.offset + index * self.period


@dataclass(frozen=True)
class Fit:
    grid: Grid
    raw_bpm: float
    times: np.ndarray
    residuals: np.ndarray


def load_for_analysis(path: Path) -> np.ndarray:
    y, _ = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    return y


def detect_beats(y: np.ndarray) -> np.ndarray:
    envelope = librosa.onset.onset_strength(y=y, sr=ANALYSIS_SR, hop_length=HOP_LENGTH)
    _, frames = librosa.beat.beat_track(
        onset_envelope=envelope, sr=ANALYSIS_SR, hop_length=HOP_LENGTH, tightness=TIGHTNESS
    )
    return librosa.frames_to_time(frames, sr=ANALYSIS_SR, hop_length=HOP_LENGTH)


def fit_grid(beats: np.ndarray, fit_range: tuple[float, float]) -> Fit:
    times = beats[(beats >= fit_range[0]) & (beats <= fit_range[1])]
    if len(times) < 16:
        raise SystemExit(f"当てはめに使える拍が少なすぎます({len(times)} 個)")

    # 拍の取りこぼしがあっても通し番号がずれないよう、隣との間隔を拍数に丸めて積み上げる
    gaps = np.diff(times)
    steps = np.rint(gaps / np.median(gaps)).astype(int)
    index = np.concatenate([[0], np.cumsum(steps)])

    slope, _ = np.polyfit(index, times, 1)
    raw_bpm = 60.0 / slope
    bpm = float(round(raw_bpm)) if abs(raw_bpm - round(raw_bpm)) < BPM_SNAP else raw_bpm
    period = 60.0 / bpm
    intercept = float(np.mean(times - index * period))
    residuals = times - (intercept + index * period)
    return Fit(Grid(bpm, intercept % period), raw_bpm, times, residuals)


def analyze_grid(y: np.ndarray, fit_range: tuple[float, float]) -> Fit:
    fit = fit_grid(detect_beats(y), fit_range)
    grid = fit.grid
    print(f"BPM        {fit.raw_bpm:.3f} (当てはめ) -> {grid.bpm:g}")
    print(f"offset     {grid.offset:.4f} s (拍 0 の時刻)")
    print(
        f"ずれ       RMS {np.sqrt(np.mean(fit.residuals**2)) * 1000:.1f} ms / "
        f"最大 {np.max(np.abs(fit.residuals)) * 1000:.1f} ms({len(fit.times)} 拍, {fit_range[0]:g}〜{fit_range[1]:g} s)"
    )
    outliers = np.abs(fit.residuals) > OUTLIER
    for t, r in zip(fit.times[outliers], fit.residuals[outliers]):
        print(f"  外れ値   {t:7.3f} s  {r * 1000:+.1f} ms")
    return fit


def downbeat_scores(y: np.ndarray, grid: Grid, fit_range: tuple[float, float]) -> np.ndarray:
    """拍の位相(通し番号 mod 4)ごとの「1拍目らしさ」。あくまで参考の手がかり。

    - 低音の立ち上がり: キックは 1拍目に来やすい(ただし 3拍目にも来やすい)
    - 和音の変化: コードは小節の頭で変わりやすい
    """
    index, times = grid.beat_times(*fit_range)

    low = librosa.onset.onset_strength(y=y, sr=ANALYSIS_SR, hop_length=HOP_LENGTH, n_mels=8, fmax=200)
    frames = librosa.time_to_frames(times, sr=ANALYSIS_SR, hop_length=HOP_LENGTH)
    near = 4  # ±23ms の中の最大値をとる
    low_at = np.array([low[max(f - near, 0) : f + near + 1].max() for f in frames])

    chroma = librosa.feature.chroma_stft(y=y, sr=ANALYSIS_SR, hop_length=HOP_LENGTH * 4)
    bounds = librosa.time_to_frames(times, sr=ANALYSIS_SR, hop_length=HOP_LENGTH * 4)
    per_beat = np.array(
        [chroma[:, a:b].mean(axis=1) if b > a else chroma[:, a] for a, b in zip(bounds[:-1], bounds[1:])]
    )
    unit = per_beat / (np.linalg.norm(per_beat, axis=1, keepdims=True) + 1e-9)
    # change[i] は拍 i-1 → 拍 i の変化。先頭の拍は前が無いので 0
    change = np.concatenate([[0.0], 1.0 - np.sum(unit[1:] * unit[:-1], axis=1), [0.0]])[: len(times)]

    phase = index % BEATS_PER_BAR
    low_mean = np.array([low_at[phase == p].mean() for p in range(BEATS_PER_BAR)])
    change_mean = np.array([change[phase == p].mean() for p in range(BEATS_PER_BAR)])

    def z(v: np.ndarray) -> np.ndarray:
        return (v - v.mean()) / (v.std() + 1e-9)

    score = z(low_mean) + z(change_mean)
    print("1拍目の手がかり(位相 = 通し番号 mod 4。参考値)")
    print("  位相  低音の立ち上がり  和音の変化  合計")
    for p in range(BEATS_PER_BAR):
        mark = "  <- 推定" if p == int(np.argmax(score)) else ""
        print(f"  {p}     {low_mean[p]:8.3f}        {change_mean[p]:8.4f}  {score[p]:+.2f}{mark}")
    return score


def load_full(path: Path) -> tuple[np.ndarray, int]:
    """聴く用に、元のサンプルレートとチャンネル数のまま読む。戻り値は (チャンネル, サンプル)"""
    audio, sr = librosa.load(path, sr=None, mono=False)
    return np.atleast_2d(audio), int(sr)


def click_sound(sr: int, freq: float) -> np.ndarray:
    t = np.arange(int(sr * 0.05)) / sr
    return np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.01)


def overlay_clicks(audio: np.ndarray, sr: int, start: float, times: np.ndarray, accents: np.ndarray) -> np.ndarray:
    """audio(start 秒から始まる区間)に拍のクリックを重ねる。1拍目は高い音。戻り値は soundfile 用の (サンプル, チャンネル)"""
    high, low = click_sound(sr, 1760.0), click_sound(sr, 880.0)
    track = np.zeros(audio.shape[1])
    for t, accent in zip(times, accents):
        sound = high if accent else low
        i = int(round((t - start) * sr))
        if 0 <= i < len(track):
            n = min(len(sound), len(track) - i)
            track[i : i + n] += sound[:n]
    mixed = audio * 0.6 + track * 0.5
    peak = float(np.max(np.abs(mixed)))
    if peak > 0.99:
        mixed *= 0.99 / peak
    return mixed.T


def loudest_window(y: np.ndarray, length: float, fit_range: tuple[float, float]) -> float:
    """fit_range の中で、音量の平均が一番大きい length 秒の区間の開始時刻(サビのあたりを狙う)"""
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    width = int(length * ANALYSIS_SR / hop)
    mean = np.convolve(rms, np.ones(width) / width, mode="valid")
    starts = librosa.frames_to_time(np.arange(len(mean)), sr=ANALYSIS_SR, hop_length=hop)
    usable = (starts >= fit_range[0]) & (starts + length <= fit_range[1])
    return float(starts[usable][np.argmax(mean[usable])])


def write_audio(path: Path, data: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, data, sr)
    print(f"書き出し   {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")


def cmd_candidates(args: argparse.Namespace) -> None:
    fit_range = (args.fit_start, args.fit_end)
    y = load_for_analysis(args.audio)
    grid = analyze_grid(y, fit_range).grid
    downbeat_scores(y, grid, fit_range)

    start = args.start if args.start is not None else loudest_window(y, args.length, fit_range)
    # 区間の頭を拍にそろえる
    start = grid.offset + np.floor((start - grid.offset) / grid.period) * grid.period
    end = start + args.length
    print(f"抜粋       {start:.2f}〜{end:.2f} s")

    audio, sr = load_full(args.audio)
    excerpt = audio[:, int(start * sr) : int(end * sr)]
    index, times = grid.beat_times(start, end)
    for p in range(BEATS_PER_BAR):
        mixed = overlay_clicks(excerpt, sr, start, times, (index - p) % BEATS_PER_BAR == 0)
        write_audio(args.out_dir / f"downbeat-{p}.wav", mixed, sr)


def cmd_analyze(args: argparse.Namespace) -> None:
    fit_range = (args.fit_start, args.fit_end)
    y = load_for_analysis(args.audio)
    grid = analyze_grid(y, fit_range).grid
    # デコードした長さ。mp3 の先頭のエンコーダ遅延を除いた長さで、Chromium の audio.duration と一致する
    duration = len(y) / ANALYSIS_SR
    print(f"長さ       {duration:.3f} s")

    data = {
        "bpm": int(grid.bpm) if grid.bpm.is_integer() else round(grid.bpm, 4),
        "offset": round(grid.offset, 4),
        "beatsPerBar": BEATS_PER_BAR,
        "downbeat": args.downbeat,
        "source": {"duration": round(duration, 3)},
    }
    args.out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"書き出し   {args.out.relative_to(ROOT) if args.out.is_relative_to(ROOT) else args.out}")


def cmd_click(args: argparse.Namespace) -> None:
    data = json.loads(args.beats.read_text(encoding="utf-8"))
    grid = Grid(float(data["bpm"]), float(data["offset"]))
    beats_per_bar = int(data["beatsPerBar"])
    downbeat = int(data["downbeat"])

    audio, sr = load_full(args.audio)
    index, times = grid.beat_times(0.0, audio.shape[1] / sr)
    mixed = overlay_clicks(audio, sr, 0.0, times, (index - downbeat) % beats_per_bar == 0)
    write_audio(args.out, mixed, sr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(required=True)

    def add_fit_range(p: argparse.ArgumentParser) -> None:
        p.add_argument("--fit-start", type=float, default=FIT_RANGE[0], help="当てはめに使う区間の開始 [s]")
        p.add_argument("--fit-end", type=float, default=FIT_RANGE[1], help="当てはめに使う区間の終了 [s]")

    p = commands.add_parser("candidates", help="1拍目の候補(位相 0〜3)ごとに、クリックを重ねた抜粋を出す")
    p.add_argument("audio", type=Path)
    p.add_argument("--start", type=float, help="抜粋の開始 [s](省略時は一番音量が大きい区間)")
    p.add_argument("--length", type=float, default=CANDIDATE_LENGTH, help="抜粋の長さ [s]")
    p.add_argument("--out-dir", type=Path, default=OUT_DIR)
    add_fit_range(p)
    p.set_defaults(run=cmd_candidates)

    p = commands.add_parser("analyze", help="拍グリッドを解析して beats.json を書く")
    p.add_argument("audio", type=Path)
    p.add_argument(
        "--downbeat", type=int, required=True, choices=range(BEATS_PER_BAR), help="1拍目の位相(candidates で聴いて決める)"
    )
    p.add_argument("--out", type=Path, default=DEFAULT_BEATS_JSON)
    add_fit_range(p)
    p.set_defaults(run=cmd_analyze)

    p = commands.add_parser("click", help="beats.json の拍を曲に重ねた wav を出す(耳での確認用)")
    p.add_argument("audio", type=Path)
    p.add_argument("--beats", type=Path, default=DEFAULT_BEATS_JSON)
    p.add_argument("--out", type=Path, default=OUT_DIR / "click.wav")
    p.set_defaults(run=cmd_click)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
