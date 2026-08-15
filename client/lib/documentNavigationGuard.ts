import * as DocumentStore from "./documentStore";

export interface DocumentEditGuard {
  documentKey: string;
  isDirty: () => boolean;
  saveBeforeTransition: () => Promise<void>;
  runWhileFrozen: (operation: () => Promise<boolean>) => Promise<boolean>;
}

let activeGuard: DocumentEditGuard | null = null;
let transition: Promise<boolean> = Promise.resolve(true);

export function registerDocumentEditGuard(guard: DocumentEditGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export function hasUnsavedDocument(): boolean {
  return (activeGuard?.isDirty() ?? false) || DocumentStore.hasAnyPendingMetadata();
}

export function requestDocumentTransition(proceed: () => void): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const guard = activeGuard;
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

export async function flushActiveDocument(): Promise<boolean> {
  const guard = activeGuard;
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

export function runWithActiveDocumentFrozen(operation: () => Promise<boolean>): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const guard = activeGuard;
    if (guard) return guard.runWhileFrozen(operation);
    if (DocumentStore.hasAnyPendingMetadata()) {
      try {
        await DocumentStore.waitForAllMetadata();
      } catch {
        return false;
      }
    }
    return operation();
  };
  transition = transition.then(run, run);
  return transition;
}
