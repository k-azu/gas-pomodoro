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
  /** Flush server sync for the given id (bypass 30s debounce) */
  flushSync?: (id: string) => void;
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
  flushSync,
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
  // Stable refs — avoids adding to useEffect deps
  const saveContentRef = useRef(saveContent);
  saveContentRef.current = saveContent;
  const flushSyncRef = useRef(flushSync);
  flushSyncRef.current = flushSync;
  // 2-second debounce for IDB writes (matches old EditorManager saveDebounceMs: 2000)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<{ id: string; content: string } | null>(null);

  /** Execute IDB save + server sync flush with debug log */
  const doSave = useCallback((trigger: string) => {
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    console.log(`[useDocumentEditor] save (${trigger}) id=${pending.id}`);
    saveContentRef.current(pending.id, pending.content);
    flushSyncRef.current?.(pending.id);
  }, []);

  /** Flush debounced save immediately */
  const flushPendingSave = useCallback(
    (trigger: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      doSave(trigger);
    },
    [doSave],
  );

  // Flush on page reload / tab close
  useEffect(() => {
    const handleBeforeUnload = () => flushPendingSave("beforeunload");
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingSave]);

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
      flushPendingSave("switch");
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
      // Flush debounced save on unmount/id-change (read from refs for closure stability)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingContentRef.current;
      if (pending) {
        pendingContentRef.current = null;
        console.log(`[useDocumentEditor] save (cleanup) id=${pending.id}`);
        saveContentRef.current(pending.id, pending.content);
        flushSyncRef.current?.(pending.id);
      }
    };
  }, [id, loadContent, resolveContent, transformOnLoad]);

  const onChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current) return;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      pendingContentRef.current = { id, content };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        doSave("debounce");
      }, 2000);
    },
    [id, transformOnSave],
  );

  return { editorRef, initialContent, onChange, syncStatus, readOnly };
}
