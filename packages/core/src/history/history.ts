import { DocumentData } from '../model/document.js';

export interface Command {
  label: string;
  do(doc: DocumentData): void;
  undo(doc: DocumentData): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  apply(doc: DocumentData, cmd: Command): void {
    cmd.do(doc);
    this.undoStack.push(cmd);
    this.redoStack = [];
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(doc: DocumentData): Command | undefined {
    const cmd = this.undoStack.pop();
    if (cmd) { cmd.undo(doc); this.redoStack.push(cmd); }
    return cmd;
  }

  redo(doc: DocumentData): Command | undefined {
    const cmd = this.redoStack.pop();
    if (cmd) { cmd.do(doc); this.undoStack.push(cmd); }
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
