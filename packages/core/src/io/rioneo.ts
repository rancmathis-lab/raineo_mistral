import { DocumentData } from '../model/document.js';

export const FORMAT_VERSION = 1;

export function serialize(doc: DocumentData): string {
  const data = { ...doc, formatVersion: FORMAT_VERSION };
  return JSON.stringify(data, null, 1);
}

export function parse(content: string): DocumentData {
  const raw = JSON.parse(content) as DocumentData & { formatVersion?: number };
  if (typeof raw.formatVersion !== 'number') {
    throw new Error('Fichier .raineo invalide : version de format absente.');
  }
  if (raw.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `Fichier .raineo créé par une version plus récente (format ${raw.formatVersion}, supporté : ${FORMAT_VERSION}).`
    );
  }
  return migrate(raw);
}

function migrate(doc: DocumentData): DocumentData {
  // Point d'entrée des migrations futures (formatVersion < FORMAT_VERSION).
  return doc;
}

export function saveAtomically(
  write: (tmpPath: string) => void,
  commit: (finalPath: string) => void,
  tmpPath: string
): void {
  write(tmpPath);
  commit(tmpPath);
}
