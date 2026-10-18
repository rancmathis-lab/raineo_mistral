import { DocumentData } from '../model/document.js';
import { Entity, translateEntity } from '../model/entities.js';
import { Id } from '../geometry/base.js';
import { findEntity, createLayer } from '../model/document.js';
import { Command } from '../history/history.js';

export function addEntityCmd(entity: Entity): Command {
  return {
    label: `Ajouter ${entity.type}`,
    do(doc) { doc.entities.push(entity); },
    undo(doc) { doc.entities = doc.entities.filter(e => e.id !== entity.id); }
  };
}

export function deleteEntitiesCmd(ids: Id[]): Command {
  let removed: Entity[] = [];
  return {
    label: 'Supprimer',
    do(doc) {
      removed = doc.entities.filter(e => ids.includes(e.id));
      doc.entities = doc.entities.filter(e => !ids.includes(e.id));
    },
    undo(doc) { doc.entities.push(...removed); }
  };
}

export function translateEntitiesCmd(ids: Id[], dx: number, dy: number): Command {
  const cache = new Map<Id, Entity>();
  return {
    label: 'Déplacer',
    do(doc) {
      for (const id of ids) {
        const e = findEntity(doc, id);
        if (e) {
          if (!cache.has(id)) cache.set(id, e);
          doc.entities = doc.entities.map(x => (x.id === id ? translateEntity(x, dx, dy) : x));
        }
      }
    },
    undo(doc) {
      for (const id of ids) {
        const original = cache.get(id);
        if (original) doc.entities = doc.entities.map(x => (x.id === id ? original : x));
      }
    }
  };
}

export function addLayerCmd(name: string): Command {
  const layer = createLayer(name);
  return {
    label: 'Ajouter calque',
    do(doc) { doc.layers.push(layer); },
    undo(doc) { doc.layers = doc.layers.filter(l => l.id !== layer.id); }
  };
}

export function setLayerVisibilityCmd(layerId: Id, visible: boolean): Command {
  return {
    label: 'Visibilité calque',
    do(doc) {
      const l = doc.layers.find(l => l.id === layerId);
      if (l) l.visible = visible;
    },
    undo(doc) {
      const l = doc.layers.find(l => l.id === layerId);
      if (l) l.visible = !visible;
    }
  };
}
