import * as DocumentStore from "./documentStore";

export type DocumentEditorKey = "memo" | "task";

export interface DocumentEditGuard {
  documentKey: string;
  isDirty: () => boolean;
  saveBeforeTransition: () => Promise<void>;
  runWhileFrozen: (operation: () => Promise<boolean>) => Promise<boolean>;
}

const guards = new Map<DocumentEditorKey, DocumentEditGuard>();
let transition: Promise<boolean> = Promise.resolve(true);

export function registerDocumentEditGuard(
  editorKey: DocumentEditorKey,
  guard: DocumentEditGuard,
): () => void {
  guards.set(editorKey, guard);
  return () => {
    if (guards.get(editorKey) === guard) guards.delete(editorKey);
  };
}

export function hasUnsavedDocument(): boolean {
  return (
    [...guards.values()].some((guard) => guard.isDirty()) || DocumentStore.hasAnyPendingMetadata()
  );
}

export function requestDocumentTransition(
  editorKey: DocumentEditorKey,
  proceed: () => void,
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const guard = guards.get(editorKey);
    if (guard?.isDirty()) {
      try {
        await guard.saveBeforeTransition();
      } catch {
        return false;
      }
    } else if (DocumentStore.hasAnyPendingMetadata()) {
      try {
        await DocumentStore.waitForAllMetadata();
      } catch {
        return false;
      }
    }
    proceed();
    return true;
  };
  transition = transition.then(run, run);
  return transition;
}

export async function flushDocument(editorKey: DocumentEditorKey): Promise<boolean> {
  const guard = guards.get(editorKey);
  if (guard?.isDirty()) {
    try {
      await guard.saveBeforeTransition();
      return true;
    } catch {
      return false;
    }
  }
  if (DocumentStore.hasAnyPendingMetadata()) {
    try {
      await DocumentStore.waitForAllMetadata();
    } catch {
      return false;
    }
  }
  return true;
}

export function runWithDocumentEditorsFrozen(operation: () => Promise<boolean>): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const registeredGuards = [...guards.values()];
    let guardedOperation = operation;
    for (const guard of registeredGuards.reverse()) {
      const next = guardedOperation;
      guardedOperation = () => guard.runWhileFrozen(next);
    }
    if (registeredGuards.length > 0) return guardedOperation();
    try {
      await DocumentStore.waitForAllMetadata();
    } catch {
      return false;
    }
    return operation();
  };
  transition = transition.then(run, run);
  return transition;
}
