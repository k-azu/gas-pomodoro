import { useRef } from "react";
import type { EditorState } from "../editor/hitomdEditor";

export interface CachedDocumentView {
  editorState?: EditorState;
  content: string;
}

export interface DocumentViewCache {
  get(key: string): CachedDocumentView | undefined;
  set(key: string, view: CachedDocumentView): void;
  update(key: string, fields: Partial<CachedDocumentView>): void;
  invalidate(key: string): void;
  scrollKey(documentKey: string | undefined, table: boolean): string;
  saveScroll(key: string, position: number): void;
  getScroll(key: string): number | undefined;
  clearScroll(documentKey: string): void;
}

class InMemoryDocumentViewCache implements DocumentViewCache {
  private readonly documents = new Map<string, CachedDocumentView>();
  private readonly scrollPositions = new Map<string, number>();

  get(key: string): CachedDocumentView | undefined {
    return this.documents.get(key);
  }

  set(key: string, view: CachedDocumentView): void {
    this.documents.set(key, view);
  }

  update(key: string, fields: Partial<CachedDocumentView>): void {
    const current = this.documents.get(key);
    if (!current) return;
    this.documents.set(key, { ...current, ...fields });
  }

  invalidate(key: string): void {
    this.documents.delete(key);
  }

  scrollKey(documentKey: string | undefined, table: boolean): string {
    return table ? `${documentKey}:t` : (documentKey ?? "");
  }

  saveScroll(key: string, position: number): void {
    this.scrollPositions.set(key, position);
  }

  getScroll(key: string): number | undefined {
    return this.scrollPositions.get(key);
  }

  clearScroll(documentKey: string): void {
    this.scrollPositions.delete(documentKey);
    this.scrollPositions.delete(`${documentKey}:t`);
  }
}

export function useDocumentViewCache(): DocumentViewCache {
  const cacheRef = useRef<DocumentViewCache | null>(null);
  if (!cacheRef.current) cacheRef.current = new InMemoryDocumentViewCache();
  return cacheRef.current;
}
