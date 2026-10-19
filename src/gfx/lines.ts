import { BufferGeometry, Float32BufferAttribute, LineSegments, Vector3, type Material } from 'three';

/** 線分を積み上げて LineSegments を作る。追加した順に描画されるので setDrawRange で「描いていく」演出に使える */
export class LineBuilder {
  private readonly positions: number[] = [];

  /** 追加済みの頂点数 */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  segment(a: Vector3, b: Vector3): this {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    return this;
  }

  polyline(points: readonly Vector3[], closed = false): this {
    for (let i = 0; i + 1 < points.length; i++) {
      this.pushPair(points, i, i + 1);
    }
    if (closed && points.length > 2) {
      this.pushPair(points, points.length - 1, 0);
    }
    return this;
  }

  /** center を中心に、u, v を軸とする円(u, v は正規直交ベクトル) */
  circle(center: Vector3, radius: number, u: Vector3, v: Vector3, segments = 24): this {
    return this.polyline(arcPoints(center, radius, u, v, 0, Math.PI * 2, segments), true);
  }

  /**
   * a から b へ向かう円柱のワイヤーフレーム。
   * rings は両端以外に入れる輪(帯)の位置を 0〜1 で指定する。
   */
  cylinder(a: Vector3, b: Vector3, radius: number, options: { longitudes?: number; rings?: readonly number[] } = {}): this {
    const { longitudes = 8, rings = [] } = options;
    const axis = new Vector3().subVectors(b, a);
    const { u, v } = orthonormalBasis(axis);
    const ringAt = (s: number): Vector3 => new Vector3().copy(a).addScaledVector(axis, s);
    for (const s of [0, 1, ...rings]) {
      this.circle(ringAt(s), radius, u, v, 16);
    }
    for (let i = 0; i < longitudes; i++) {
      const theta = (i / longitudes) * Math.PI * 2;
      const offset = new Vector3()
        .addScaledVector(u, Math.cos(theta) * radius)
        .addScaledVector(v, Math.sin(theta) * radius);
      this.segment(new Vector3().addVectors(a, offset), new Vector3().addVectors(b, offset));
    }
    return this;
  }

  build(material: Material): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    return new LineSegments(geometry, material);
  }

  private pushPair(points: readonly Vector3[], i: number, j: number): void {
    const a = points[i];
    const b = points[j];
    if (a !== undefined && b !== undefined) {
      this.segment(a, b);
    }
  }
}

export function arcPoints(
  center: Vector3,
  radius: number,
  u: Vector3,
  v: Vector3,
  from: number,
  to: number,
  segments: number,
): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = from + ((to - from) * i) / segments;
    points.push(
      new Vector3()
        .copy(center)
        .addScaledVector(u, Math.cos(theta) * radius)
        .addScaledVector(v, Math.sin(theta) * radius),
    );
  }
  return points;
}

/** axis に直交する正規直交ベクトル u, v */
export function orthonormalBasis(axis: Vector3): { u: Vector3; v: Vector3 } {
  const n = axis.clone().normalize();
  const helper = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(n, helper).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  return { u, v };
}
