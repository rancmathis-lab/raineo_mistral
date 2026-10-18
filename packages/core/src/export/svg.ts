import { DocumentData, findLayer } from '../model/document.js';
import { Entity } from '../model/entities.js';

export interface SvgExportOptions {
  includeDimensions: boolean;
  includeConstruction: boolean;
  includeAnnotations: boolean;
}

const STYLE_COLORS: Record<string, string> = {
  cut: '#d40000',
  crease: '#0070c0',
  construction: '#909090',
  annotation: '#008000'
};

function fmt(n: number): string {
  return Math.abs(n) < 1e-9 ? '0' : String(Math.round(n * 1e6) / 1e6);
}

function entityToSvg(e: Entity): string {
  switch (e.type) {
    case 'line':
      return `<line x1="${fmt(e.a.x)}" y1="${fmt(-e.a.y)}" x2="${fmt(e.b.x)}" y2="${fmt(-e.b.y)}"/>`;
    case 'rect':
      return `<rect x="${fmt(e.corner.x)}" y="${fmt(-(e.corner.y + e.height))}" width="${fmt(e.width)}" height="${fmt(e.height)}"/>`;
    case 'circle':
      return `<circle cx="${fmt(e.center.x)}" cy="${fmt(-e.center.y)}" r="${fmt(e.radius)}"/>`;
    case 'polyline': {
      const pts = [...e.points, ...(e.closed ? [e.points[0]] : [])]
        .map(p => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
      return `<polyline points="${pts}"/>`;
    }
  }
}

export function exportSvg(doc: DocumentData, opts: SvgExportOptions): string {
  const visible = doc.entities.filter(e => {
    const layer = findLayer(doc, e.layerId);
    if (!layer || !layer.visible) return false;
    if (layer.isDimensionLayer) return opts.includeDimensions;
    if (layer.isConstructionLayer) return opts.includeConstruction;
    if (e.style === 'annotation') return opts.includeAnnotations;
    return true;
  });
  if (visible.length === 0) return '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of visible) {
    const pts = entityPoints(e);
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const groupsByStyle = new Map<string, string[]>();
  for (const e of visible) {
    const list = groupsByStyle.get(e.style) ?? [];
    list.push(entityToSvg(e));
    groupsByStyle.set(e.style, list);
  }
  const w = fmt(maxX - minX), h = fmt(maxY - minY);
  const groups = [...groupsByStyle.entries()]
    .map(([style, els]) =>
      `<g fill="none" stroke="${STYLE_COLORS[style] ?? '#000'}" stroke-width="0.1" data-raineo-style="${style}">\n${els.join('\n')}\n</g>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${fmt(minX)} ${fmt(-maxY)} ${w} ${h}">
<title>${escapeXml(doc.name)}</title>
${groups}
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

function entityPoints(e: Entity): { x: number; y: number }[] {
  switch (e.type) {
    case 'line': return [e.a, e.b];
    case 'rect': return [
      e.corner,
      { x: e.corner.x + e.width, y: e.corner.y },
      { x: e.corner.x + e.width, y: e.corner.y + e.height },
      { x: e.corner.x, y: e.corner.y + e.height }
    ];
    case 'circle': return [
      { x: e.center.x - e.radius, y: e.center.y },
      { x: e.center.x + e.radius, y: e.center.y }
    ];
    case 'polyline': return e.points;
  }
}
