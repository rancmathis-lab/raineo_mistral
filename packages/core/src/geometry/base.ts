export type Id = string;

export interface Point {
  x: number;
  y: number;
}

export function pid(): Id {
  return 'e' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function bboxOfPoints(pts: Point[]): { min: Point; max: Point } {
  if (pts.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function rectsIntersect(
  a: { min: Point; max: Point },
  b: { min: Point; max: Point }
): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

export function rectContains(
  outer: { min: Point; max: Point },
  inner: { min: Point; max: Point }
): boolean {
  return (
    outer.min.x <= inner.min.x && outer.min.y <= inner.min.y &&
    outer.max.x >= inner.max.x && outer.max.y >= inner.max.y
  );
}
