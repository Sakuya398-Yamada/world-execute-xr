/**
 * 一様な電場 E0(+x 向き)の中に置いた、接地した導体球(半径 R、中心は原点)のまわりの電気力線。three.js には依存しない。
 *
 * 球の外の電位は φ = −E0 (r − R³/r²) cosθ(θ は +x 軸からの角)。軸対称なので、力線はストークスの流れ関数
 *   ψ = (E0 / 2) sin²θ (r² + 2R³/r)
 * が一定の曲線になる。軸から ρ0 離れたところから来る力線は、ρ を軸からの距離として
 *   ρ² (1 + 2R³ / r³) = ρ0²   (r² = x² + ρ²)
 * を満たす。ρ0 < √3 R の力線は球に当たって終わり(表面の負の電荷)、反対側の表面(正の電荷)から出ていく。球の中に力線は無い。
 */

/** 力線の上の点(x と、軸からの距離 ρ) */
export interface FieldPoint {
  readonly x: number;
  readonly rho: number;
}

/**
 * 軸から ρ0 離れたところから来る力線を、x の列に沿ってたどる。
 * 球の中に入る区間は除き、球に当たる力線は表面の点で切って、球の手前と向こうの2本に分ける。
 * @param radius 球の半径。0 なら力線はまっすぐ
 * @param xs 昇順の x の列
 */
export function cageFieldLine(rho0: number, radius: number, xs: readonly number[]): FieldPoint[][] {
  const pieces: FieldPoint[][] = [];
  let current: FieldPoint[] = [];
  const hitRho = rho0 / Math.sqrt(3);
  const hits = radius > 0 && hitRho < radius;
  const hitX = hits ? Math.sqrt(radius * radius - hitRho * hitRho) : 0;
  for (const x of xs) {
    const rho = radius > 0 ? solveRho(rho0, radius, x) : rho0;
    if (rho === null) {
      // 球の中: 手前の力線は表面の点で終わる
      if (current.length > 0) {
        if (hits && x > -hitX) current.push({ x: -hitX, rho: hitRho });
        pieces.push(current);
        current = [];
      }
      continue;
    }
    if (current.length === 0 && pieces.length > 0 && hits) {
      // 球の向こう側: 表面の点から出ていく
      current.push({ x: hitX, rho: hitRho });
    }
    current.push({ x, rho });
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

/** x での力線の ρ。球の中になるなら null */
function solveRho(rho0: number, radius: number, x: number): number | null {
  const r3 = radius ** 3;
  const f = (rho: number): number => rho * rho * (1 + (2 * r3) / (x * x + rho * rho) ** 1.5) - rho0 * rho0;
  // 球の外(r ≥ R)では f は ρ について単調に増えるので、二分法で解く
  const lo0 = Math.sqrt(Math.max(radius * radius - x * x, 0));
  // 表面上ですでに ψ を超える(= この x では力線が球の中を通る)なら、球の外に点は無い
  if (f(lo0) >= 0) return null;
  let lo = lo0;
  let hi = Math.max(rho0, lo0);
  if (f(hi) < 0) return null;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 球の表面の誘導電荷密度 σ / (ε0 E0) = 3 cosθ(θ は +x 軸からの角) */
export function inducedCharge(x: number, radius: number): number {
  return (3 * x) / radius;
}
