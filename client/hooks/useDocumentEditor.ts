/**
 * useDocumentEditor — shared hook for loading/switching/saving editor content
 *
 * On first mount: loads content via loadContent() and sets initialContent state.
 * On id change (while mounted): calls editorRef.switchDocument() so tiptap
 * preserves undo/redo and cursor per documentId.
 *
 * Optional resolveContent: when provided, puts the editor in readOnly mode
 * while checking server consistency, then applies the result.
 *
 * Save suppression: wrapper deduplicates onChange (skips when content unchanged),
 * so switchDocument / setEditable / updateState won't trigger saves.
 * suppressSaveRef only covers resolve (setValue of server content shouldn't save back).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { MarkdownEditorRef } from "../components/shared/MarkdownEditorWrapper";
import type { SyncStatus } from "../components/shared/SyncIndicator";

interface UseDocumentEditorOptions {
  id: string;
  loadContent: (id: string) => Promise<string | null>;
  saveContent: (id: string, content: string) => void;
  resolveContent?: (id: string) => Promise<{ useServer: boolean; content?: string } | null>;
  /** Transform content after loading (e.g. resolve Drive URLs to blob URLs) */
  transformOnLoad?: (content: string) => string | Promise<string>;
  /** Transform content before saving (e.g. convert blob URLs to Drive URLs) */
  transformOnSave?: (content: string) => string;
}

// Track documents that have been synced in this session — skip resolve on re-open
const _syncedIds = new Set<string>();

/** Run resolveContent and apply result to editor */
function startResolve(
  id: string,
  resolveContent: (id: string) => Promise<{ useServer: boolean; content?: string } | null>,
  editorRef: React.RefObject<MarkdownEditorRef | null>,
  callbacks: {
    setSyncStatus: (s: SyncStatus) => void;
    setReadOnly: (b: boolean) => void;
    setInitialContent?: (c: string) => void;
    suppressSaveRef: React.RefObject<boolean>;
    cancelledRef: { current: boolean };
    transformOnLoad?: (content: string) => string | Promise<string>;
  },
): void {
  const {
    setSyncStatus,
    setReadOnly,
    setInitialContent,
    suppressSaveRef,
    cancelledRef,
    transformOnLoad,
  } = callbacks;
  setReadOnly(true);
  setSyncStatus("syncing");
  suppressSaveRef.current = true;

  resolveContent(id)
    .then(async (result) => {
      if (cancelledRef.current) return;
      _syncedIds.add(id);
      if (result && result.useServer && result.content != null) {
        const content = transformOnLoad ? await transformOnLoad(result.content) : result.content;
        if (cancelledRef.current) return;
        if (editorRef.current) {
          editorRef.current.setValue(content);
        } else {
          setInitialContent?.(content);
        }
      }
      setSyncStatus("synced");
    })
    .catch(() => {
      if (cancelledRef.current) return;
      setSyncStatus("error");
    })
    .finally(() => {
      if (cancelledRef.current) return;
      suppressSaveRef.current = false;
      setReadOnly(false);
    });
}

export function useDocumentEditor({
  id,
  loadContent,
  saveContent,
  resolveContent,
  transformOnLoad,
  transformOnSave,
}: UseDocumentEditorOptions) {
  const editorRef = useRef<MarkdownEditorRef | null>(null);
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const prevIdRef = useRef<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [readOnly, setReadOnly] = useState(false);
  // Suppress saveContent during server resolve — setValue of server content shouldn't save back
  const suppressSaveRef = useRef(false);

  useEffect(() => {
    if (!id) return;

    const cancelledRef = { current: false };
    const isSwitch = prevIdRef.current !== null && prevIdRef.current !== id;
    prevIdRef.current = id;

    const doResolve = (useInitialContent: boolean) => {
      if (resolveContent && !_syncedIds.has(id)) {
        startResolve(id, resolveContent, editorRef, {
          setSyncStatus,
          setReadOnly,
          suppressSaveRef,
          cancelledRef,
          setInitialContent: useInitialContent ? setInitialContent : undefined,
          transformOnLoad,
        });
      } else {
        setSyncStatus("idle");
        setReadOnly(false);
      }
    };

    /** Load from IDB, apply transformOnLoad, return transformed content */
    const load = async (docId: string): Promise<string> => {
      const raw = (await loadContent(docId)) || "";
      return transformOnLoad ? await transformOnLoad(raw) : raw;
    };

    if (isSwitch && editorRef.current) {
      if (editorRef.current.hasDocument(id)) {
        // キャッシュあり → IDB スキップ、content なしで切り替え
        editorRef.current.switchDocument(id);
        doResolve(false);
      } else {
        // キャッシュなし → IDB から読み込み
        load(id).then((content) => {
          if (cancelledRef.current) return;
          editorRef.current?.switchDocument(id, content);
          doResolve(false);
        });
      }
    } else {
      // 初回ロード
      load(id).then((content) => {
        if (cancelledRef.current) return;
        setInitialContent(content);
        doResolve(true);
      });
    }

    return () => {
      cancelledRef.current = true;
    };
  }, [id, loadContent, resolveContent, transformOnLoad]);

  const onChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current) return;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      saveContent(id, content);
    },
    [id, saveContent, transformOnSave],
  );

  return { editorRef, initialContent, onChange, syncStatus, readOnly };
}
