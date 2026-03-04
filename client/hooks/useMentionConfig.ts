/**
 * useMentionConfig — React port of setupMentionConfig() from EditorManager.html
 *
 * Module-level caches updated on EntityStore "dataChanged" events.
 * items callbacks read from cache synchronously (tiptap requirement).
 * onClick callbacks call navigateToDocument for tab+doc navigation.
 */
import { useMemo, useEffect, useRef } from "react";
import { useNavigation } from "../contexts/NavigationContext";
import type { MentionTrigger } from "tiptap-markdown-editor";
import * as MemoStore from "../lib/memoStore";
import * as TaskStore from "../lib/taskStore";
import * as EntityStore from "../lib/entityStore";

// =========================================================
// Module-level caches (shared across all hook instances)
// =========================================================

interface MentionEntry {
  id: string;
  label: string;
}

interface TaskCacheEntry {
  id: string;
  label: string;
  status: string;
}

let _memoCache: MentionEntry[] = [];
let _taskCache: TaskCacheEntry[] = [];
let _entityCache: MentionEntry[] = [];
let _cacheInitialized = false;

async function refreshCaches(): Promise<void> {
  try {
    const [memos, tasks, projects, cases] = await Promise.all([
      MemoStore.getMemos(),
      TaskStore.getAllTasks(),
      TaskStore.getAllProjects(),
      TaskStore.getAllCases(),
    ]);

    // Memo cache: @
    _memoCache = memos.map((m: any) => ({
      id: m.id,
      label: m.name || "(無題)",
    }));

    // Build project/case name maps for task labels
    const projMap: Record<string, string> = {};
    (projects as any[]).forEach((p) => {
      projMap[p.id] = p.name;
    });
    const caseMap: Record<string, any> = {};
    (cases as any[]).forEach((c) => {
      caseMap[c.id] = c;
    });

    // Task cache: # (with status for picker filtering)
    _taskCache = (tasks as any[]).map((t) => {
      let path = projMap[t.projectId] || "";
      if (t.caseId && caseMap[t.caseId]) {
        path += " > " + caseMap[t.caseId].name;
      }
      return {
        id: t.id,
        label: t.name + (path ? ` (${path})` : ""),
        status: t.status || "",
      };
    });

    // Entity cache: ! (projects + cases)
    _entityCache = [
      ...(projects as any[]).map((p) => ({
        id: `project:${p.id}`,
        label: p.name,
      })),
      ...(cases as any[]).map((c) => ({
        id: `case:${c.id}`,
        label: c.name + (projMap[c.projectId] ? ` (${projMap[c.projectId]})` : ""),
      })),
    ];
  } catch {
    // Stores may not be ready yet — caches stay empty until next event
  }
}

function ensureCacheListener(): void {
  if (_cacheInitialized) return;
  _cacheInitialized = true;
  refreshCaches();
  EntityStore.on("dataChanged", () => {
    refreshCaches();
  });
}

// =========================================================
// Hook
// =========================================================

export function useMentionConfig(): MentionTrigger[] {
  const nav = useNavigation();
  const navRef = useRef(nav);
  navRef.current = nav;

  // Start listening on mount
  useEffect(() => {
    ensureCacheListener();
  }, []);

  // Build stable MentionTrigger array (never changes reference → no tiptap reinit)
  return useMemo<MentionTrigger[]>(
    () => [
      {
        char: "@",
        scheme: "mention",
        items: (query: string) => {
          const q = query.toLowerCase();
          return _memoCache.filter((m) => m.label.toLowerCase().includes(q)).slice(0, 20);
        },
        onClick: (id: string) => {
          navRef.current.navigateToDocument("memo", { memoId: id });
        },
      },
      {
        char: "#",
        scheme: "task",
        items: (query: string) => {
          const q = query.toLowerCase();
          return _taskCache.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 20);
        },
        onClick: (id: string) => {
          navRef.current.navigateToDocument("task", {
            taskNode: { type: "task", id },
          });
        },
      },
      {
        char: "!",
        scheme: "entity",
        items: (query: string) => {
          const q = query.toLowerCase();
          return _entityCache.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 20);
        },
        onClick: (compositeId: string) => {
          // compositeId is "project:xxx" or "case:xxx"
          const sep = compositeId.indexOf(":");
          if (sep === -1) return;
          const type = compositeId.slice(0, sep);
          const id = compositeId.slice(sep + 1);
          navRef.current.navigateToDocument("task", {
            taskNode: { type, id },
          });
        },
      },
    ],
    [],
  );
}
