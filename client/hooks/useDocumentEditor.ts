/**
 * useDocumentEditor — shared hook for loading/switching/saving editor content
 *
 * On first mount: loads content via loadContent() and sets initialContent state.
 * On id change (while mounted): calls editorRef.switchDocument() so tiptap
 * preserves undo/redo and cursor per documentId.
 *
 * Optional resolveContent: when provided, kicks off a background resolve that
 * continues even when the user switches to another document. Results are
 * delivered via EntityStore "contentResolved" events + IDB, so that stale
 * editor caches are invalidated and content is updated.
 *
 * Save suppression: wrapper deduplicates onChange (skips when content unchanged),
 * so switchDocument / setEditable / updateState won't trigger saves.
 * suppressSaveRef only covers resolve (setValue of server content shouldn't save back).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { MarkdownEditorRef } from "../components/shared/DocumentEditor";
import type { SyncStatus } from "../components/shared/SyncIndicator";
import * as EntityStore from "../lib/entityStore";

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

// Track resolve status per document in this session
const _resolveStatus = new Map<string, "resolving" | "synced">();

/** Fire-and-forget resolve — runs in background, results delivered via IDB + events */
function ensureResolved(
  id: string,
  resolveContent: (id: string) => Promise<{ useServer: boolean; content?: string } | null>,
): void {
  if (_resolveStatus.has(id)) return; // resolving or synced → skip
  _resolveStatus.set(id, "resolving");
  resolveContent(id)
    .then(() => {
      _resolveStatus.set(id, "synced");
      EntityStore.emit("resolveComplete", { id });
    })
    .catch(() => {
      _resolveStatus.delete(id); // 次回表示時にリトライ可能に
      EntityStore.emit("resolveError", { id });
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
  // Track which document the editor is actually displaying
  const currentDocIdRef = useRef(id);
  // Stable refs — avoids adding to useEffect deps
  const saveContentRef = useRef(saveContent);
  saveContentRef.current = saveContent;
  const flushSyncRef = useRef(flushSync);
  flushSyncRef.current = flushSync;
  // 2-second debounce for IDB writes (matches old EditorManager saveDebounceMs: 2000)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<{ id: string; content: string } | null>(null);

  /** Execute IDB save (server sync is handled by entityStore's 30s debounce) */
  const doSave = useCallback(() => {
    const pending = pendingContentRef.current;
    if (!pending) return;
    pendingContentRef.current = null;
    saveContentRef.current(pending.id, pending.content);
  }, []);

  /** Flush debounced save immediately + trigger server sync (for switch/unload) */
  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingContentRef.current;
    doSave();
    if (pending) flushSyncRef.current?.(pending.id);
  }, [doSave]);

  // Flush on page reload / tab close
  useEffect(() => {
    const handleBeforeUnload = () => flushPendingSave();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingSave]);

  // Main effect: load/switch documents + resolve
  useEffect(() => {
    if (!id) return;

    const cancelledRef = { current: false };
    const isSwitch = prevIdRef.current !== null && prevIdRef.current !== id;
    prevIdRef.current = id;

    // Set sync status based on resolve state
    const status = resolveContent ? _resolveStatus.get(id) : undefined;
    if (!resolveContent || status === "synced") {
      setSyncStatus("idle");
      setReadOnly(false);
    } else {
      // "resolving" or not started yet → show syncing
      setSyncStatus("syncing");
      setReadOnly(true);
    }

    /** Load from IDB, apply transformOnLoad, return transformed content */
    const load = async (docId: string): Promise<string> => {
      const raw = (await loadContent(docId)) || "";
      return transformOnLoad ? await transformOnLoad(raw) : raw;
    };

    if (isSwitch && editorRef.current) {
      flushPendingSave();
      const hasDoc = editorRef.current.hasDocument(id);
      const resolveStatus = _resolveStatus.get(id);
      // resolve が一度も実行されていないドキュメントはキャッシュが空の可能性がある
      // → キャッシュミスパスで IDB から再読み込みして resolve を実行
      const needsResolve = resolveContent && !resolveStatus;
      if (hasDoc && !needsResolve) {
        // キャッシュあり＆resolve 済み → IDB スキップ、content なしで切り替え
        currentDocIdRef.current = id;
        editorRef.current.switchDocument(id);
        // Kick off background resolve after switch (idempotent)
        if (resolveContent) ensureResolved(id, resolveContent);
      } else {
        // needsResolve の場合、stale キャッシュを無効化
        if (hasDoc) editorRef.current.invalidateDocument(id);
        // キャッシュなし → 2段階で切替:
        //   1. switchDocument(id, "") — 即座に空ドキュメントとして切替。
        //      旧ドキュメントの内容がasync gap中に表示されるのを防止。
        //      tiptap側では新規EditorState(空)が作られる。
        //   2. switchDocument(id, content) — IDBロード後にコンテンツをセット。
        //      同一IDなのでtiptapはドキュメント切替ではなく通常のvalue syncとして処理。
        setReadOnly(true);
        currentDocIdRef.current = id;
        suppressSaveRef.current = true;
        editorRef.current.switchDocument(id, "");
        load(id).then((content) => {
          if (cancelledRef.current) {
            suppressSaveRef.current = false;
            return;
          }
          if (content) {
            editorRef.current?.switchDocument(id, content);
          }
          // resolve 未完了なら suppress 維持 (onResolveComplete/Error で解除)
          if (!resolveContent || _resolveStatus.get(id) === "synced") {
            suppressSaveRef.current = false;
            setReadOnly(false);
          }
          // Kick off background resolve after load (idempotent)
          if (resolveContent) ensureResolved(id, resolveContent);
        });
      }
    } else {
      // 初回ロード
      // resolve 未完了なら suppress 維持: 空エディタの onChange が IDB に空保存
      // → _contentDirtyAt → resolve がサーバーコンテンツを無視する問題を防止
      if (resolveContent && status !== "synced") {
        suppressSaveRef.current = true;
      }
      load(id).then((content) => {
        if (cancelledRef.current) {
          suppressSaveRef.current = false;
          return;
        }
        currentDocIdRef.current = id;
        setInitialContent(content);
        // resolve 不要 or 完了済みなら suppress 解除
        if (!resolveContent || _resolveStatus.get(id) === "synced") {
          suppressSaveRef.current = false;
        }
        // Kick off background resolve after initial content set (idempotent)
        if (resolveContent) ensureResolved(id, resolveContent);
      });
    }

    // Event listeners for resolve results on the DISPLAYED document
    const onContentResolved = async (event: { id: string; content: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      const content = transformOnLoad ? await transformOnLoad(event.content) : event.content;
      if (cancelledRef.current) return;
      // suppressSaveRef は resolve 完了まで維持 (onResolveComplete で解除)
      // ここでは true を保証するだけで、false にしない
      suppressSaveRef.current = true;
      if (editorRef.current) {
        editorRef.current.setValue(content);
      } else {
        setInitialContent(content);
      }
    };

    const onResolveComplete = (event: { id: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      suppressSaveRef.current = false;
      setReadOnly(false);
      setSyncStatus((prev) => (prev === "syncing" ? "synced" : prev));
      // Brief "synced" flash, then idle
      setTimeout(() => {
        if (cancelledRef.current) return;
        setSyncStatus((prev) => (prev === "synced" ? "idle" : prev));
      }, 400);
    };

    const onResolveError = (event: { id: string }) => {
      if (event.id !== id || cancelledRef.current) return;
      suppressSaveRef.current = false;
      setSyncStatus("error");
      setReadOnly(false);
    };

    if (resolveContent) {
      EntityStore.on("contentResolved", onContentResolved);
      EntityStore.on("resolveComplete", onResolveComplete);
      EntityStore.on("resolveError", onResolveError);
    }

    return () => {
      cancelledRef.current = true;
      if (resolveContent) {
        EntityStore.off("contentResolved", onContentResolved);
        EntityStore.off("resolveComplete", onResolveComplete);
        EntityStore.off("resolveError", onResolveError);
      }
      // Flush debounced save on unmount/id-change (IDB + server sync)
      flushPendingSave();
    };
  }, [id, loadContent, resolveContent, transformOnLoad, flushPendingSave]);

  // Invalidate editor cache for non-displayed documents when contentResolved fires
  useEffect(() => {
    if (!resolveContent) return;
    const handler = (event: { id: string }) => {
      if (event.id === prevIdRef.current) return; // 表示中はメインuseEffectが処理
      editorRef.current?.invalidateDocument(event.id);
    };
    EntityStore.on("contentResolved", handler);
    return () => EntityStore.off("contentResolved", handler);
  }, [resolveContent]);

  const onChange = useCallback(
    (markdown: string) => {
      if (suppressSaveRef.current) return;
      const docId = currentDocIdRef.current;
      const content = transformOnSave ? transformOnSave(markdown) : markdown;
      pendingContentRef.current = { id: docId, content };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        doSave();
      }, 2000);
    },
    [transformOnSave, doSave],
  );

  return { editorRef, initialContent, onChange, syncStatus, readOnly };
}
