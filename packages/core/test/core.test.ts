import { describe, it, expect } from 'vitest';
import {
  createDocument, findLayer, DocumentData
} from '../src/model/document.js';
import { History } from '../src/history/history.js';
import {
  addEntityCmd, deleteEntitiesCmd, translateEntitiesCmd, setLayerVisibilityCmd
} from '../src/history/commands.js';
import { makeLine, makeRect, makeCircle } from '../src/model/entities.js';
import { serialize, parse, FORMAT_VERSION } from '../src/io/rioneo.js';
import { exportSvg } from '../src/export/svg.js';

function freshDoc(): DocumentData {
  return createDocument('Test');
}

describe('document', () => {
  it('crée les calques par défaut avec un calque Découpe actif', () => {
    const doc = freshDoc();
    expect(doc.layers.map(l => l.name)).toEqual(['Découpe', 'Cotes', 'Construction']);
    expect(findLayer(doc, doc.activeLayerId)!.name).toBe('Découpe');
  });
});

describe('historique', () => {
  it('un geste = une commande annulable', () => {
    const doc = freshDoc();
    const h = new History();
    const line = makeLine(doc.activeLayerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    h.apply(doc, addEntityCmd(line));
    expect(doc.entities).toHaveLength(1);
    h.undo(doc);
    expect(doc.entities).toHaveLength(0);
    h.redo(doc);
    expect(doc.entities).toHaveLength(1);
  });

  it('déplacement : undo restaure la position exacte', () => {
    const doc = freshDoc();
    const h = new History();
    const rect = makeRect(doc.activeLayerId, { x: 0, y: 0 }, 100, 50);
    h.apply(doc, addEntityCmd(rect));
    h.apply(doc, translateEntitiesCmd([rect.id], 25, -10));
    expect(doc.entities[0].type === 'rect' ? doc.entities[0].corner.x : 0).toBe(25);
    h.undo(doc);
    const restored = doc.entities.find(e => e.id === rect.id)!;
    expect(restored.type === 'rect' ? restored.corner : null).toEqual({ x: 0, y: 0 });
  });

  it('suppression multiple annulable', () => {
    const doc = freshDoc();
    const h = new History();
    const a = makeLine(doc.activeLayerId, { x: 0, y: 0 }, { x: 1, y: 1 });
    const b = makeCircle(doc.activeLayerId, { x: 5, y: 5 }, 2);
    h.apply(doc, addEntityCmd(a));
    h.apply(doc, addEntityCmd(b));
    h.apply(doc, deleteEntitiesCmd([a.id, b.id]));
    expect(doc.entities).toHaveLength(0);
    h.undo(doc);
    expect(doc.entities).toHaveLength(2);
  });

  it('redo vidé après nouvelle action', () => {
    const doc = freshDoc();
    const h = new History();
    const a = makeLine(doc.activeLayerId, { x: 0, y: 0 }, { x: 1, y: 1 });
    h.apply(doc, addEntityCmd(a));
    h.undo(doc);
    const b = makeLine(doc.activeLayerId, { x: 2, y: 2 }, { x: 3, y: 3 });
    h.apply(doc, addEntityCmd(b));
    expect(h.canRedo()).toBe(false);
  });

  it('visibilité de calque annulable', () => {
    const doc = freshDoc();
    const h = new History();
    h.apply(doc, setLayerVisibilityCmd(doc.activeLayerId, false));
    expect(findLayer(doc, doc.activeLayerId)!.visible).toBe(false);
    h.undo(doc);
    expect(findLayer(doc, doc.activeLayerId)!.visible).toBe(true);
  });
});

describe('format .raineo', () => {
  it('sauvegarde puis recharge un document à l\'identique', () => {
    const doc = freshDoc();
    const line = makeLine(doc.activeLayerId, { x: 0, y: 0 }, { x: 42, y: 7 });
    doc.entities.push(line);
    const reloaded = parse(serialize(doc));
    expect(reloaded.formatVersion).toBe(FORMAT_VERSION);
    expect(reloaded.entities).toEqual(doc.entities);
    expect(reloaded.layers).toEqual(doc.layers);
  });

  it('refuse un format absent ou trop récent', () => {
    expect(() => parse('{}')).toThrow();
    const doc = freshDoc();
    const s = serialize(doc).replace('"formatVersion": 1', '"formatVersion": 99');
    expect(() => parse(s)).toThrow(/plus récente/);
  });
});

describe('export SVG', () => {
  it('génère un SVG en mm à l\'échelle 1:1 avec groupes par style', () => {
    const doc = freshDoc();
    doc.entities.push(
      makeRect(doc.activeLayerId, { x: 0, y: 0 }, 100, 50),
      makeCircle(doc.activeLayerId, { x: 50, y: 25 }, 5)
    );
    const svg = exportSvg(doc, { includeDimensions: false, includeConstruction: false, includeAnnotations: false });
    expect(svg).toContain('width="100mm"');
    expect(svg).toContain('height="50mm"');
    expect(svg).toContain('data-raineo-style="cut"');
  });

  it('exclut les calques de construction et cotes selon les options', () => {
    const doc = freshDoc();
    const cons = doc.layers.find(l => l.isConstructionLayer)!;
    doc.entities.push(makeLine(cons.id, { x: 0, y: 0 }, { x: 1, y: 1 }, 'construction'));
    const off = exportSvg(doc, { includeDimensions: false, includeConstruction: false, includeAnnotations: false });
    expect(off).toBe('');
    const on = exportSvg(doc, { includeDimensions: false, includeConstruction: true, includeAnnotations: false });
    expect(on).toContain('construction');
  });
});
