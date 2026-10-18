import { Id, pid } from '../geometry/base.js';
import { Entity } from './entities.js';

export interface Layer {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  isDimensionLayer?: boolean;
  isConstructionLayer?: boolean;
}

export interface Piece {
  id: Id;
  name: string;
  entityIds: Id[];
  transform: { x: number; y: number; rotation: number };
}

export interface DocumentData {
  formatVersion: number;
  name: string;
  layers: Layer[];
  activeLayerId: Id;
  entities: Entity[];
  pieces: Piece[];
}

export function createLayer(name: string): Layer {
  return { id: pid(), name, visible: true, locked: false };
}

export function createDocument(name: string): DocumentData {
  const cut = createLayer('Découpe');
  const dim = createLayer('Cotes');
  dim.isDimensionLayer = true;
  const cons = createLayer('Construction');
  cons.isConstructionLayer = true;
  return {
    formatVersion: 1,
    name,
    layers: [cut, dim, cons],
    activeLayerId: cut.id,
    entities: [],
    pieces: []
  };
}

export function findEntity(doc: DocumentData, id: Id): Entity | undefined {
  return doc.entities.find(e => e.id === id);
}

export function findLayer(doc: DocumentData, id: Id): Layer | undefined {
  return doc.layers.find(l => l.id === id);
}

export function isFabrication(e: Entity, doc: DocumentData): boolean {
  const layer = findLayer(doc, e.layerId);
  if (!layer) return false;
  return !layer.isDimensionLayer && !layer.isConstructionLayer && e.style !== 'construction' && e.style !== 'annotation';
}
