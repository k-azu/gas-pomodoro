/**
 * useMemos — Memo CRUD, tag management, selection state
 */
import { useState, useEffect, useCallback, useRef } from "react";
import * as MemoStore from "../lib/memoStore";
import * as DocumentStore from "../lib/documentStore";
import type { MemoTag } from "../types";
import { STORAGE_KEYS, lsGet, lsSet, lsRemove } from "../lib/localStorage";
import { useNavigation } from "../contexts/NavigationContext";
import { flushDocument, requestDocumentTransition } from "../lib/documentNavigationGuard";

export interface MemoItem {
  id: string;
  name: string;
  tags: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface UseMemosReturn {
  memos: MemoItem[];
  activeId: string | null;
  tags: MemoTag[];
  selectMemo: (id: string) => void;
  createMemo: () => Promise<void>;
  deleteMemo: (id: string) => Promise<void>;
  renameMemo: (id: string, name: string) => void;
  reorderMemos: (ids: string[]) => void;
  addTagToMemo: (id: string, tag: string) => void;
  removeTagFromMemo: (id: string, tag: string) => void;
  addTag: (name: string, color?: string) => void;
  updateTagColor: (name: string, color: string) => void;
  updateTags: (id: string, tags: string[]) => void;
  isLoading: boolean;
}

export function useMemos(): UseMemosReturn {
  const nav = useNavigation();
  const [memos, setMemos] = useState<MemoItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tags, setTags] = useState<MemoTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const refreshFromStore = useCallback(async () => {
    const list = await MemoStore.getMemos();
    setMemos(list as MemoItem[]);
    setTags(MemoStore.getTags());
    return list;
  }, []);

  // Listen for in-memory document changes
  useEffect(() => {
    const handler = (detail: { entityType?: string }) => {
      if (!detail || detail.entityType === "memo" || detail.entityType === "all") {
        refreshFromStore();
      }
    };
    DocumentStore.on(handler);
    return () => DocumentStore.off(handler);
  }, [refreshFromStore]);

  // Initial load — determine active memo
  useEffect(() => {
    refreshFromStore().then((list) => {
      const saved = lsGet(STORAGE_KEYS.MEMO_ACTIVE);
      let id: string | null = null;
      if (saved && list.some((m: MemoItem) => m.id === saved)) {
        id = saved;
      } else if (list.length > 0) {
        id = list[0].id;
        lsSet(STORAGE_KEYS.MEMO_ACTIVE, id!);
      }
      if (id) {
        setActiveId(id);
        nav.notifyMemoChange(id, { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore memo from popstate — re-read from localStorage when restoreSeq changes
  const lastSeenSeqRef = useRef(nav.restoreSeq);
  useEffect(() => {
    if (nav.restoreSeq !== lastSeenSeqRef.current) {
      lastSeenSeqRef.current = nav.restoreSeq;
      const saved = lsGet(STORAGE_KEYS.MEMO_ACTIVE);
      if (saved) {
        setActiveId(saved);
      }
    }
  }, [nav.restoreSeq]);

  const selectMemo = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      void requestDocumentTransition("memo", () => {
        setActiveId(id);
        lsSet(STORAGE_KEYS.MEMO_ACTIVE, id);
        nav.notifyMemoChange(id);
      });
    },
    [nav],
  );

  const createMemo = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!(await flushDocument("memo"))) return;
      const id = await MemoStore.addMemo("新しいメモ");
      await refreshFromStore();
      setActiveId(id);
      lsSet(STORAGE_KEYS.MEMO_ACTIVE, id);
      nav.notifyMemoChange(id);
    } finally {
      setIsLoading(false);
    }
  }, [refreshFromStore, nav]);

  const deleteMemo = useCallback(
    async (id: string) => {
      setIsLoading(true);
      try {
        if (activeIdRef.current === id && !(await flushDocument("memo"))) return;
        await MemoStore.deleteMemo(id);
        const list = await refreshFromStore();
        if (activeIdRef.current === id) {
          const newActive = list.length > 0 ? list[0].id : null;
          setActiveId(newActive);
          if (newActive) lsSet(STORAGE_KEYS.MEMO_ACTIVE, newActive);
          else lsRemove(STORAGE_KEYS.MEMO_ACTIVE);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [refreshFromStore],
  );

  const renameMemo = useCallback((id: string, name: string) => {
    void MemoStore.renameMemo(id, name).catch((error) =>
      console.error("Memo metadata save failed; the patch remains pending", error),
    );
    setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)));
  }, []);

  const reorderMemos = useCallback((ids: string[]) => {
    void MemoStore.reorderMemos(ids).catch((error) =>
      console.error("Memo order save failed", error),
    );
    setMemos((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      return ids.map((id, i) => {
        const m = map.get(id)!;
        return { ...m, sortOrder: i + 1 };
      });
    });
  }, []);

  const addTagToMemo = useCallback((id: string, tag: string) => {
    setMemos((prev) =>
      prev.map((m) => {
        if (m.id !== id || m.tags.includes(tag)) return m;
        const newTags = [...m.tags, tag];
        void MemoStore.updateTags(id, newTags).catch((error) =>
          console.error("Memo metadata save failed; the patch remains pending", error),
        );
        return { ...m, tags: newTags };
      }),
    );
  }, []);

  const removeTagFromMemo = useCallback((id: string, tag: string) => {
    setMemos((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const newTags = m.tags.filter((t) => t !== tag);
        void MemoStore.updateTags(id, newTags).catch((error) =>
          console.error("Memo metadata save failed; the patch remains pending", error),
        );
        return { ...m, tags: newTags };
      }),
    );
  }, []);

  const addTag = useCallback((name: string, color = "#757575") => {
    MemoStore.addTag(name, color);
    setTags(MemoStore.getTags());
  }, []);

  const updateTagColor = useCallback((name: string, color: string) => {
    MemoStore.updateTagColor(name, color);
    setTags(MemoStore.getTags());
  }, []);

  const updateTagsAction = useCallback((id: string, newTags: string[]) => {
    void MemoStore.updateTags(id, newTags).catch((error) =>
      console.error("Memo metadata save failed; the patch remains pending", error),
    );
    setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, tags: newTags } : m)));
  }, []);

  return {
    memos,
    activeId,
    tags,
    selectMemo,
    createMemo,
    deleteMemo,
    renameMemo,
    reorderMemos,
    addTagToMemo,
    removeTagFromMemo,
    addTag,
    updateTagColor,
    updateTags: updateTagsAction,
    isLoading,
  };
}
