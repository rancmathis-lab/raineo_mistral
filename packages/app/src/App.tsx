import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentData, Entity, History, Id, Point,
  createDocument, findLayer,
  addEntityCmd, translateEntitiesCmd, deleteEntitiesCmd,
  makeLine, makeRect, makeCircle, makePolyline,
  serialize, parse, exportSvg
} from '@raineo/core';

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'polyline';

const MM_PER_PX = 0.5;

function useDocument() {
  const docRef = useRef<DocumentData>(createDocument('Sans titre'));
  const historyRef = useRef<History>(new History());
  const [, force] = useState(0);
  const bump = useCallback(() => force(v => v + 1), []);
  const apply = useCallback((cmd: Parameters<History['apply']>[1]) => {
    historyRef.current.apply(docRef.current, cmd);
    bump();
  }, [bump]);
  const undo = useCallback(() => { historyRef.current.undo(docRef.current); bump(); }, [bump]);
  const redo = useCallback(() => { historyRef.current.redo(docRef.current); bump(); }, [bump]);
  return { docRef, historyRef, apply, undo, redo, bump };
}

export default function App() {
  const { docRef, historyRef, apply, undo, redo, bump } = useDocument();
  const [style, setStyle] = useState<'cut' | 'crease' | 'construction' | 'annotation'>('cut');
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Set<Id>>(new Set());
  const [status, setStatus] = useState('Prêt');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ panX: 100, panY: 100, zoom: 1 });
  const dragRef = useRef<any>(null);
  const drawRef = useRef<{ points: Point[] } | null>(null);
  const [drawPts, setDrawPts] = useState<Point[]>([]);

  const doc = docRef.current;

  const toWorld = useCallback((ev: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (ev.clientX - r.left - v.panX) / (v.zoom / MM_PER_PX),
      y: -(ev.clientY - r.top - v.panY) / (v.zoom / MM_PER_PX)
    };
  }, []);

  // ===== rendu =====
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#26282b';
    ctx.fillRect(0, 0, w, h);
    const v = viewRef.current;
    const s = v.zoom / MM_PER_PX;
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(s, -s);

    const colors: Record<string, string> = {
      cut: '#e05050', crease: '#4d9fff', construction: '#808080', annotation: '#4dbb63'
    };
    for (const e of doc.entities) {
      const layer = findLayer(doc, e.layerId);
      if (!layer?.visible) continue;
      const selected = selection.has(e.id);
      ctx.strokeStyle = selected ? '#ffffff' : colors[e.style] ?? '#eee';
      ctx.lineWidth = selected ? 0.4 : 0.25;
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
    }
    // aperçu du tracé en cours
    if (drawPts.length > 0) {
      ctx.strokeStyle = '#ffd070';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.moveTo(drawPts[0].x, drawPts[0].y);
      for (let i = 1; i < drawPts.length; i++) ctx.lineTo(drawPts[i].x, drawPts[i].y);
      ctx.stroke();
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
  }, [render]);

  // ===== clavier =====
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.ctrlKey && ev.key.toLowerCase() === 'z' && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); undo(); }
      else if (ev.key === 'Delete' && selection.size > 0) {
        apply(deleteEntitiesCmd([...selection])); setSelection(new Set());
      } else if (ev.key === 'Escape') { setDrawPts([]); drawRef.current = null; setSelection(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, apply, selection]);

  // ===== souris =====
  const pickEntity = useCallback((p: Point): Id | null => {
    const tol = 5 * MM_PER_PX / viewRef.current.zoom * 0.5;
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
        (dragRef.current as any).moving = [...next];
        (dragRef.current as any).originals = new Map(
          doc.entities.filter(e => next.has(e.id)).map(e => [e.id, e])
        );
      }
      return;
    }
    // outils de dessin
    if (tool === 'polyline') {
      setDrawPts(prev => {
        const pts = [...prev, p];
        return pts;
      });
      return;
    }
    drawRef.current = { points: [p] };
    setDrawPts([p]);
    setStatus(`${tool} : cliquez pour définir le second point`);
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
      setStatus(`Polyligne : ${drawPts.length + 1} points — clic pour ajouter, double-clic ou Entrée pour terminer`);
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

  const onMouseUp = (ev: React.MouseEvent) => {
    const d = dragRef.current;
    if (d && d.moving) {
      const ids = d.moving as Id[];
      const originals = d.originals as Map<Id, Entity>;
      const finalPositions = new Map(doc.entities.filter(e => ids.includes(e.id)).map(e => [e.id, e]));
      const cmd = {
        label: 'Déplacer',
        do(doc2: DocumentData) {
          doc2.entities = doc2.entities.map(e => finalPositions.get(e.id) ?? e);
        },
        undo(doc2: DocumentData) {
          doc2.entities = doc2.entities.map(e => originals.get(e.id) ?? e);
        }
      };
      historyRef.current.apply(doc, cmd);
      bump();
      dragRef.current = null;
      return;
    }
    dragRef.current = null;
    if (drawRef.current && drawPts.length >= 2 && tool !== 'polyline') {
      finishDraw(drawPts);
    }
  };

  const onDoubleClick = () => {
    if (tool === 'polyline' && drawPts.length >= 2) finishDraw(drawPts);
  };

  const onKeyDownCanvas = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' && tool === 'polyline' && drawPts.length >= 2) finishDraw(drawPts);
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
      const loaded = parse(text);
      docRef.current = loaded;
      historyRef.current.clear();
      setSelection(new Set());
      bump();
      setStatus(`Ouvert : ${loaded.name}`);
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
    setStatus('SVG exporté (1:1, mm)');
  };

  const tools: { id: Tool; label: string }[] = [
    { id: 'select', label: 'Sélection' },
    { id: 'line', label: 'Ligne' },
    { id: 'rect', label: 'Rectangle' },
    { id: 'circle', label: 'Cercle' },
    { id: 'polyline', label: 'Polyligne' }
  ];

  return (
    <div className="app">
      <div className="menubar">
        <strong style={{ color: '#fff' }}>Rainéo</strong>
        <label>Nouveau
          <input type="file" accept=".raineo" hidden onChange={e => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
        <button onClick={save}>Enregistrer</button>
        <label>Ouvrir
          <input type="file" accept=".raineo" hidden onChange={e => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
        <button onClick={exportSvgFile}>Exporter SVG</button>
        <button onClick={undo}>Annuler</button>
        <button onClick={redo}>Rétablir</button>
      </div>
      <div className="toolbar">
        {tools.map(t => (
          <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => { setTool(t.id); setDrawPts([]); drawRef.current = null; }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="main">
        <div className="canvaswrap">
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDownCanvas}
            tabIndex={0}
          />
        </div>
        <div className="sidepanel">
          <h3>Calques</h3>
          {doc.layers.map(l => (
            <div key={l.id} className={`layer-row ${l.id === doc.activeLayerId ? 'active-layer' : ''}`}>
              <input
                type="checkbox"
                checked={l.visible}
                onChange={() => { l.visible = !l.visible; bump(); }}
              />
              <span onClick={() => { docRef.current.activeLayerId = l.id; bump(); }}>{l.name}</span>
            </div>
          ))}
          <h3>Style de trait</h3>
          <div className="section">
            {(['cut', 'crease', 'construction', 'annotation'] as const).map(s => (
              <div key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                <input
                  type="radio"
                  name="style"
                  value={s}
                  checked={style === s}
                  onChange={() => setStyle(s)}
                />
                <span style={{ color: s === 'cut' ? '#e05050' : s === 'crease' ? '#4d9fff' : s === 'construction' ? '#808080' : '#4dbb63' }}>
                  {s === 'cut' ? 'Découpe' : s === 'crease' ? 'Rainage' : s === 'construction' ? 'Construction' : 'Annotation'}
                </span>
              </div>
            ))}
          </div>
          <h3>Sélection</h3>
          <div>{selection.size} élément(s)</div>
          <h3>Navigation</h3>
          <div style={{ lineHeight: 1.6 }}>
            Molette : zoom<br />
            Alt+clic ou clic milieu : déplacer la vue<br />
            Ctrl+Z : annuler<br />
            Suppr : supprimer
          </div>
        </div>
      </div>
      <div className="statusbar">{status} — Zoom {Math.round((viewRef.current.zoom / MM_PER_PX) * 1000) / 10}%</div>
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
