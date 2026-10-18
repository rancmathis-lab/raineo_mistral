import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DocumentData, Entity, History, Id, Point,
  createDocument, findLayer,
  addEntityCmd, deleteEntitiesCmd,
  makeLine, makeRect, makeCircle, makePolyline,
  serialize, parse, exportSvg
} from '@raineo/core';
import { IconSelect, IconLine, IconRect, IconCircle, IconPolyline } from './icons.js';

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'polyline';
type Style = 'cut' | 'crease' | 'construction' | 'annotation';

const STYLE_INFO: Record<Style, { label: string; color: string }> = {
  cut: { label: 'Découpe', color: '#c94f46' },
  crease: { label: 'Rainage', color: '#3f7fb5' },
  construction: { label: 'Construction', color: '#9b8f80' },
  annotation: { label: 'Annotation', color: '#5f9e6a' }
};

const LAYER_COLORS = ['#c94f46', '#3f7fb5', '#9b8f80', '#5f9e6a', '#a8684c', '#8a6fae'];

export default function App() {
  const docRef = useRef<DocumentData>(createDocument('Sans titre'));
  const historyRef = useRef<History>(new History());
  const [started, setStarted] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<Style>('cut');
  const [selection, setSelection] = useState<Set<Id>>(new Set());
  const [status, setStatus] = useState('Prêt');
  const [, force] = useState(0);
  const bump = useCallback(() => force(v => v + 1), []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ panX: 80, panY: 60, zoom: 2 });
  const dragRef = useRef<any>(null);
  const drawRef = useRef<{ points: Point[] } | null>(null);
  const [drawPts, setDrawPts] = useState<Point[]>([]);

  const doc = docRef.current;

  const apply = useCallback((cmd: Parameters<History['apply']>[1]) => {
    historyRef.current.apply(docRef.current, cmd);
    bump();
  }, [bump]);
  const undo = useCallback(() => { historyRef.current.undo(docRef.current); bump(); }, [bump]);
  const redo = useCallback(() => { historyRef.current.redo(docRef.current); bump(); }, [bump]);

  const toWorld = useCallback((ev: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (ev.clientX - r.left - v.panX) / v.zoom,
      y: -(ev.clientY - r.top - v.panY) / v.zoom
    };
  }, []);

  // ===== rendu =====
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f5ede3';
    ctx.fillRect(0, 0, w, h);
    const v = viewRef.current;
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, -v.zoom);

    // grille adaptative (pas en mm : 1, 5, 10, 50, 100)
    const pxPerMm = v.zoom;
    let step = 1;
    for (const s of [1, 5, 10, 50, 100, 500]) {
      if (s * pxPerMm >= 14) { step = s; break; }
      step = s;
    }
    const left = -v.panX / v.zoom, right = (w - v.panX) / v.zoom;
    const bottom = -(h - v.panY) / v.zoom, top = v.panY / v.zoom;
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = '#e3d6c6';
    ctx.beginPath();
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      ctx.moveTo(x, bottom); ctx.lineTo(x, top);
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();

    // axes origine
    ctx.strokeStyle = '#c8b8a4';
    ctx.lineWidth = 1.5 / v.zoom;
    ctx.beginPath();
    ctx.moveTo(left, 0); ctx.lineTo(right, 0);
    ctx.moveTo(0, bottom); ctx.lineTo(0, top);
    ctx.stroke();

    // entités
    for (const e of doc.entities) {
      const layer = findLayer(doc, e.layerId);
      if (!layer?.visible) continue;
      const selected = selection.has(e.id);
      ctx.strokeStyle = selected ? '#2b2320' : STYLE_INFO[e.style as Style]?.color ?? '#c94f46';
      ctx.lineWidth = (selected ? 1.4 : 0.8) / Math.max(1, v.zoom * 0.35);
      if (selected) ctx.setLineDash([4 / v.zoom, 3 / v.zoom]);
      ctx.beginPath();
      switch (e.type) {
        case 'line':
          ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); break;
        case 'rect':
          ctx.rect(e.corner.x, e.corner.y, e.width, e.height); break;
        case 'circle':
          ctx.arc(e.center.x, e.center.y, e.radius, 0, Math.PI * 2); break;
        case 'polyline': {
          if (e.points.length > 0) {
            ctx.moveTo(e.points[0].x, e.points[0].y);
            for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
            if (e.closed) ctx.closePath();
          }
          break;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // aperçu du tracé en cours
    if (drawPts.length > 0) {
      ctx.strokeStyle = '#e8934a';
      ctx.lineWidth = 0.8 / Math.max(1, v.zoom * 0.35);
      ctx.setLineDash([3 / v.zoom, 2 / v.zoom]);
      ctx.beginPath();
      ctx.moveTo(drawPts[0].x, drawPts[0].y);
      for (let i = 1; i < drawPts.length; i++) ctx.lineTo(drawPts[i].x, drawPts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }, [doc, selection, drawPts]);

  useEffect(() => { render(); });
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(c);
    return () => ro.disconnect();
  }, [render, started]);

  // ===== molette zoom =====
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const v = viewRef.current;
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.min(40, Math.max(0.5, v.zoom * factor));
      v.panX = mx - (mx - v.panX) * (nz / v.zoom);
      v.panY = my - (my - v.panY) * (nz / v.zoom);
      v.zoom = nz;
      render();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [render, started]);

  // ===== clavier =====
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.ctrlKey && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if (ev.key === 'Delete' && selection.size > 0) {
        apply(deleteEntitiesCmd([...selection])); setSelection(new Set());
      } else if (ev.key === 'Escape') { setDrawPts([]); drawRef.current = null; setSelection(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, apply, selection]);

  // ===== souris =====
  const pickEntity = useCallback((p: Point): Id | null => {
    const tol = 6 / viewRef.current.zoom;
    let best: Id | null = null, bestD = Infinity;
    for (const e of doc.entities) {
      const layer = findLayer(doc, e.layerId);
      if (!layer?.visible || layer.locked) continue;
      const d = distanceToEntity(e, p);
      if (d < tol && d < bestD) { bestD = d; best = e.id; }
    }
    return best;
  }, [doc]);

  const onMouseDown = (ev: React.MouseEvent) => {
    const p = toWorld(ev);
    if (ev.button === 1 || (ev.button === 0 && ev.altKey)) {
      dragRef.current = { start: p, screenStart: { x: ev.clientX, y: ev.clientY }, moving: false };
      return;
    }
    if (tool === 'select') {
      const hit = pickEntity(p);
      const next = new Set(ev.ctrlKey ? selection : []);
      if (hit) {
        if (ev.ctrlKey && next.has(hit)) next.delete(hit); else next.add(hit);
        setSelection(next);
      } else if (!ev.ctrlKey) setSelection(new Set());
      dragRef.current = { start: p, screenStart: { x: ev.clientX, y: ev.clientY }, moving: false };
      if (hit) {
        dragRef.current.moving = [...next];
        dragRef.current.originals = new Map(doc.entities.filter(e => next.has(e.id)).map(e => [e.id, e]));
      }
      return;
    }
    if (tool === 'polyline') {
      setDrawPts(prev => [...prev, p]);
      return;
    }
    if (!drawRef.current) {
      drawRef.current = { points: [p] };
      setDrawPts([p]);
      setStatus(`${tool} : cliquez pour définir le second point`);
      return;
    }
    const pts = [drawRef.current.points[0], p];
    drawRef.current.points = pts;
    finishDraw(pts);
  };

  const onMouseMove = (ev: React.MouseEvent) => {
    const d = dragRef.current;
    if (d && !d.moving) {
      if ((ev.buttons & 6) !== 0) {
        viewRef.current.panX += ev.clientX - d.screenStart.x;
        viewRef.current.panY += ev.clientY - d.screenStart.y;
        d.screenStart = { x: ev.clientX, y: ev.clientY };
      }
    }
    if (d && d.moving && (ev.buttons & 1)) {
      const p = toWorld(ev);
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      d.start = p;
      const ids = d.moving as Id[];
      doc.entities = doc.entities.map(e => ids.includes(e.id) ? translateQuick(e, dx, dy) : e);
      bump();
    }
    if (drawRef.current && drawPts.length >= 1) {
      const p = toWorld(ev);
      setDrawPts(prev => [prev[0], p]);
    }
    if (tool === 'polyline' && drawPts.length >= 1) {
      setStatus(`Polyligne : ${drawPts.length} point(s) — clic pour ajouter, double-clic pour terminer`);
    }
  };

  const finishDraw = (finalPts: Point[]) => {
    const layerId = doc.activeLayerId;
    if (finalPts.length >= 2) {
      let e: Entity;
      switch (tool) {
        case 'line':
          e = makeLine(layerId, finalPts[0], finalPts[1], style); break;
        case 'rect': {
          const x = Math.min(finalPts[0].x, finalPts[1].x);
          const y = Math.min(finalPts[0].y, finalPts[1].y);
          e = makeRect(layerId, { x, y }, Math.abs(finalPts[1].x - finalPts[0].x), Math.abs(finalPts[1].y - finalPts[0].y), style);
          break;
        }
        case 'circle': {
          e = makeCircle(layerId, finalPts[0], Math.hypot(finalPts[1].x - finalPts[0].x, finalPts[1].y - finalPts[0].y), style);
          break;
        }
        case 'polyline':
          e = makePolyline(layerId, finalPts, false, style); break;
        default: return;
      }
      apply(addEntityCmd(e));
      setStatus(`${tool} ajouté`);
    }
    drawRef.current = null;
    setDrawPts([]);
  };

  const onMouseUp = () => {
    const d = dragRef.current;
    if (d && d.moving) {
      const ids = d.moving as Id[];
      const originals = d.originals as Map<Id, Entity>;
      const finalPositions = new Map(doc.entities.filter(e => ids.includes(e.id)).map(e => [e.id, e]));
      const cmd = {
        label: 'Déplacer',
        do(doc2: DocumentData) { doc2.entities = doc2.entities.map(e => finalPositions.get(e.id) ?? e); },
        undo(doc2: DocumentData) { doc2.entities = doc2.entities.map(e => originals.get(e.id) ?? e); }
      };
      historyRef.current.apply(doc, cmd);
      bump();
      dragRef.current = null;
      return;
    }
    dragRef.current = null;
  };

  const onDoubleClick = () => {
    if (tool === 'polyline' && drawPts.length >= 2) finishDraw(drawPts);
  };

  // ===== fichiers =====
  const save = () => {
    const blob = new Blob([serialize(doc)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name || 'sans-titre'}.raineo`;
    a.click();
    setStatus('Document enregistré (.raineo)');
  };

  const open = async (file: File) => {
    try {
      const text = await file.text();
      docRef.current = parse(text);
      historyRef.current.clear();
      setSelection(new Set());
      setStarted(true);
      bump();
      setStatus(`Ouvert : ${docRef.current.name}`);
    } catch (err: any) {
      setStatus(`Erreur : ${err.message}`);
    }
  };

  const exportSvgFile = () => {
    const svg = exportSvg(doc, { includeDimensions: false, includeConstruction: false, includeAnnotations: false });
    if (!svg) { setStatus('Rien à exporter'); return; }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name || 'sans-titre'}.svg`;
    a.click();
    setStatus('SVG exporté (échelle 1:1, millimètres)');
  };

  const zoomPct = Math.round(viewRef.current.zoom / 2 * 100);

  // ===== écran d'accueil =====
  if (!started) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <span className="logo">Rain<span className="accent">éo</span></span>
          <div className="tagline">Conception structurelle d'emballages en carton</div>
          <div className="welcome-actions">
            <button onClick={() => { setStarted(true); setStatus('Nouveau document — choisissez un outil et dessinez'); }}>
              Nouveau document
            </button>
            <label>
              <button className="secondary" onClick={e => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}>Ouvrir un fichier…</button>
              <input type="file" accept=".raineo" onChange={e => e.target.files?.[0] && open(e.target.files[0])} />
            </label>
          </div>
          <div className="welcome-note">Format .raineo — export SVG à l'échelle 1:1</div>
        </div>
      </div>
    );
  }

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Sélection', icon: <IconSelect /> },
    { id: 'line', label: 'Ligne', icon: <IconLine /> },
    { id: 'rect', label: 'Rectangle', icon: <IconRect /> },
    { id: 'circle', label: 'Cercle', icon: <IconCircle /> },
    { id: 'polyline', label: 'Polyligne', icon: <IconPolyline /> }
  ];

  return (
    <div className="app">
      <div className="menubar">
        <span className="logo">Rain<span className="accent">éo</span></span>
        <div className="menu-sep" />
        <button className="ghost" onClick={save}>Enregistrer</button>
        <label>
          <button className="ghost" onClick={e => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}>Ouvrir</button>
          <input type="file" accept=".raineo" onChange={e => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
        <button className="ghost" onClick={exportSvgFile}>Exporter SVG</button>
        <div className="menu-sep" />
        <button className="ghost" onClick={undo}>Annuler</button>
        <button className="ghost" onClick={redo}>Rétablir</button>
      </div>
      <div className="toolbar">
        <div className="group">
          {tools.map(t => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              title={t.label}
              onClick={() => { setTool(t.id); setDrawPts([]); drawRef.current = null; }}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="main">
        <div className="canvaswrap">
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDoubleClick={onDoubleClick}
          />
          <div className="zoom-badge">{zoomPct}%</div>
        </div>
        <div className="sidepanel">
          <h3>Calques</h3>
          {doc.layers.map((l, i) => (
            <div
              key={l.id}
              className={`layer-row ${l.id === doc.activeLayerId ? 'active-layer' : ''}`}
              onClick={() => { docRef.current.activeLayerId = l.id; bump(); }}
            >
              <input
                type="checkbox"
                checked={l.visible}
                onClick={e => e.stopPropagation()}
                onChange={() => { l.visible = !l.visible; bump(); }}
              />
              <span className="dot" style={{ background: LAYER_COLORS[i % LAYER_COLORS.length] }} />
              <span className="name">{l.name}</span>
            </div>
          ))}
          <h3>Type de trait</h3>
          {(['cut', 'crease', 'construction', 'annotation'] as Style[]).map(s => (
            <label key={s} className="style-radio">
              <input type="radio" name="style" checked={style === s} onChange={() => setStyle(s)} />
              <span className="swatch" style={{ background: STYLE_INFO[s].color }} />
              {STYLE_INFO[s].label}
            </label>
          ))}
          <h3>Sélection</h3>
          <div>{selection.size} élément(s)</div>
          <h3>Aide</h3>
          <div style={{ lineHeight: 1.7, color: 'var(--fg-dim)' }}>
            Molette : zoom<br />
            Alt+clic ou clic milieu : déplacer la vue<br />
            Ctrl+clic : sélection multiple<br />
            Ctrl+Z : annuler — Suppr : supprimer<br />
            Échap : annuler le tracé
          </div>
        </div>
      </div>
      <div className="statusbar">
        <span className="main-status">{status}</span>
        <span>Zoom {zoomPct}%</span>
        <span>Unité : mm</span>
      </div>
    </div>
  );
}

function translateQuick(e: Entity, dx: number, dy: number): Entity {
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  switch (e.type) {
    case 'line': return { ...e, a: t(e.a), b: t(e.b) };
    case 'rect': return { ...e, corner: t(e.corner) };
    case 'circle': return { ...e, center: t(e.center) };
    case 'polyline': return { ...e, points: e.points.map(t) };
  }
}

function distanceToEntity(e: Entity, p: Point): number {
  switch (e.type) {
    case 'line': return distSeg(p, e.a, e.b);
    case 'rect': {
      const c = [
        [e.corner, { x: e.corner.x + e.width, y: e.corner.y }],
        [{ x: e.corner.x + e.width, y: e.corner.y }, { x: e.corner.x + e.width, y: e.corner.y + e.height }],
        [{ x: e.corner.x + e.width, y: e.corner.y + e.height }, { x: e.corner.x, y: e.corner.y + e.height }],
        [{ x: e.corner.x, y: e.corner.y + e.height }, e.corner]
      ] as [Point, Point][];
      return Math.min(...c.map(([a, b]) => distSeg(p, a, b)));
    }
    case 'circle': return Math.abs(Math.hypot(p.x - e.center.x, p.y - e.center.y) - e.radius);
    case 'polyline': {
      let d = Infinity;
      const pts = e.closed ? [...e.points, e.points[0]] : e.points;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distSeg(p, pts[i], pts[i + 1]));
      return d;
    }
  }
}

function distSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
