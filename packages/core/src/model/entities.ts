import { Id, Point, pid } from '../geometry/base.js';

export type EntityType = 'line' | 'rect' | 'circle' | 'polyline';

export type LineStyle = 'cut' | 'crease' | 'construction' | 'annotation';

export interface EntityBase {
  id: Id;
  type: EntityType;
  layerId: Id;
  style: LineStyle;
}

export interface LineEntity extends EntityBase {
  type: 'line';
  a: Point;
  b: Point;
}

export interface RectEntity extends EntityBase {
  type: 'rect';
  corner: Point;
  width: number;
  height: number;
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  center: Point;
  radius: number;
}

export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  points: Point[];
  closed: boolean;
}

export type Entity = LineEntity | RectEntity | CircleEntity | PolylineEntity;

export function makeLine(layerId: Id, a: Point, b: Point, style: LineStyle = 'cut'): LineEntity {
  return { id: pid(), type: 'line', layerId, style, a, b };
}

export function makeRect(
  layerId: Id, corner: Point, width: number, height: number, style: LineStyle = 'cut'
): RectEntity {
  return { id: pid(), type: 'rect', layerId, style, corner, width, height };
}

export function makeCircle(
  layerId: Id, center: Point, radius: number, style: LineStyle = 'cut'
): CircleEntity {
  return { id: pid(), type: 'circle', layerId, style, center, radius };
}

export function makePolyline(
  layerId: Id, points: Point[], closed = false, style: LineStyle = 'cut'
): PolylineEntity {
  return { id: pid(), type: 'polyline', layerId, style, points, closed };
}

export function translateEntity(e: Entity, dx: number, dy: number): Entity {
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  switch (e.type) {
    case 'line':
      return { ...e, a: t(e.a), b: t(e.b) };
    case 'rect':
      return { ...e, corner: t(e.corner) };
    case 'circle':
      return { ...e, center: t(e.center) };
    case 'polyline':
      return { ...e, points: e.points.map(t) };
  }
}

export function bbox(e: Entity): { min: Point; max: Point } {
  switch (e.type) {
    case 'line':
      return {
        min: { x: Math.min(e.a.x, e.b.x), y: Math.min(e.a.y, e.b.y) },
        max: { x: Math.max(e.a.x, e.b.x), y: Math.max(e.a.y, e.b.y) }
      };
    case 'rect':
      return {
        min: { x: e.corner.x, y: e.corner.y },
        max: { x: e.corner.x + e.width, y: e.corner.y + e.height }
      };
    case 'circle':
      return {
        min: { x: e.center.x - e.radius, y: e.center.y - e.radius },
        max: { x: e.center.x + e.radius, y: e.center.y + e.radius }
      };
    case 'polyline': {
      const xs = e.points.map(p => p.x);
      const ys = e.points.map(p => p.y);
      return {
        min: { x: Math.min(...xs), y: Math.min(...ys) },
        max: { x: Math.max(...xs), y: Math.max(...ys) }
      };
    }
  }
}

export function distanceTo(e: Entity, p: Point): number {
  switch (e.type) {
    case 'line':
      return distToSeg(p, e.a, e.b);
    case 'rect': {
      const c = [
        [e.corner, { x: e.corner.x + e.width, y: e.corner.y }],
        [{ x: e.corner.x + e.width, y: e.corner.y }, { x: e.corner.x + e.width, y: e.corner.y + e.height }],
        [{ x: e.corner.x + e.width, y: e.corner.y + e.height }, { x: e.corner.x, y: e.corner.y + e.height }],
        [{ x: e.corner.x, y: e.corner.y + e.height }, e.corner]
      ] as [Point, Point][];
      return Math.min(...c.map(([a, b]) => distToSeg(p, a, b)));
    }
    case 'circle':
      return Math.abs(Math.hypot(p.x - e.center.x, p.y - e.center.y) - e.radius);
    case 'polyline': {
      let d = Infinity;
      const pts = e.closed ? [...e.points, e.points[0]] : e.points;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distToSeg(p, pts[i], pts[i + 1]));
      return d;
    }
  }
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
