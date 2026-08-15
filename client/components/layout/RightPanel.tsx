import { useEffect, useRef, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { useNavigation } from "../../contexts/NavigationContext";
import type { TabId } from "../../contexts/NavigationContext";
import * as DocumentStore from "../../lib/documentStore";
import type { Phase } from "../../types/timer";
import { MemoTab } from "../memo/MemoTab";
import { TaskTab } from "../task/TaskTab";
import { RecordForm } from "../record/RecordForm";
import { InterruptionForm } from "../record/InterruptionForm";
import { ViewerPanel } from "../record/ViewerPanel";
import { SearchPalette } from "../search/SearchPalette";
import { SearchIcon } from "../shared/Icons";
import { SyncIndicator, type SyncStatus } from "../shared/SyncIndicator";
import s from "./RightPanel.module.css";

/** Which tabs are visible in each timer phase */
const TAB_VISIBILITY: Record<Phase, Record<string, boolean>> = {
  idle: { memo: true, task: true },
  work: { memo: true, task: true, record: true },
  interrupted: { memo: true, task: true, record: true, interruption: true },
  shortBreak: { memo: true, task: true },
  longBreak: { memo: true, task: true },
  breakDone: { memo: true, task: true },
};

/** Tabs that trigger auto-switch when they become newly visible */
const AUTO_SWITCH_TABS: ReadonlySet<TabId> = new Set(["record", "interruption"]);

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: "memo", label: "メモ" },
  { id: "task", label: "タスク" },
  { id: "record", label: "記録" },
  { id: "interruption", label: "中断" },
  { id: "viewer", label: "履歴詳細" },
];

export function RightPanel() {
  const { timer, refreshDocuments } = useApp();
  const nav = useNavigation();
  const { activeTab, viewerState } = nav;
  const phase = timer.state.phase;
  const prevPhaseRef = useRef<Phase | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshingDocuments, setRefreshingDocuments] = useState(false);
  const [metadataSyncStatus, setMetadataSyncStatus] = useState<SyncStatus>("idle");

  useEffect(() => {
    const handleDocumentEvent = (event: { op: string }) => {
      if (event.op === "metadataPending") setMetadataSyncStatus("syncing");
      if (event.op === "metadataError") setMetadataSyncStatus("error");
      if (event.op === "metadataSettled" && !DocumentStore.hasAnyPendingMetadata()) {
        setMetadataSyncStatus("idle");
      }
    };
    DocumentStore.on(handleDocumentEvent);
    return () => DocumentStore.off(handleDocumentEvent);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Unified visibility: phase-based + viewer (when viewerState is set)
  const vis: Record<string, boolean> = {
    ...(TAB_VISIBILITY[phase] || TAB_VISIBILITY.idle),
    ...(viewerState ? { viewer: true } : {}),
  };

  // --- Tab auto-switch (visibility-based) ---
  // Rule 1: A tab in AUTO_SWITCH_TABS became newly visible → switch to it
  // Rule 2: Current tab became invisible → restoreTab
  const viewerOpen = !!viewerState;
  useEffect(() => {
    if (activeTab === "settings") {
      prevPhaseRef.current = phase;
      return;
    }

    // Rule 1: auto-switch to newly visible tab
    if (prevPhaseRef.current !== null && prevPhaseRef.current !== phase) {
      const prevVis = TAB_VISIBILITY[prevPhaseRef.current] || TAB_VISIBILITY.idle;
      const newTab = [...AUTO_SWITCH_TABS].find((tab) => vis[tab] && !prevVis[tab]);
      if (newTab) {
        prevPhaseRef.current = phase;
        nav.switchTab(newTab, { skipHistory: true });
        return;
      }
    }
    prevPhaseRef.current = phase;

    // Rule 2: current tab became invisible → restore
    if (!vis[activeTab]) {
      nav.restoreTab(vis, { skipHistory: true });
    }
  }, [phase, activeTab, viewerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={s["app-right"]}>
      <div className={s["tab-bar"]}>
        {ALL_TABS.map((tab) => {
          if (!vis[tab.id]) return null;
          return (
            <button
              key={tab.id}
              className={`${s["tab-btn"]}${activeTab === tab.id ? ` ${s.active}` : ""}`}
              onClick={() => nav.switchTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
        <div className={s["tab-spacer"]} />
        <SyncIndicator status={metadataSyncStatus} />
        <button
          type="button"
          className={s["search-button"]}
          disabled={refreshingDocuments}
          onClick={() => {
            setRefreshingDocuments(true);
            void refreshDocuments().finally(() => setRefreshingDocuments(false));
          }}
          title="文書をサーバーから再読み込み"
        >
          {refreshingDocuments ? "更新中..." : "更新"}
        </button>
        <button
          type="button"
          className={s["search-button"]}
          onClick={() => setSearchOpen(true)}
          title="検索を開く (Ctrl/Cmd+K)"
          aria-label="検索を開く"
        >
          <SearchIcon size={15} />
          <span>検索</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
      <div className={s["tab-content"]}>
        {vis.memo && (
          <div style={{ display: activeTab === "memo" ? "contents" : "none" }}>
            <MemoTab />
          </div>
        )}
        {vis.task && (
          <div style={{ display: activeTab === "task" ? "contents" : "none" }}>
            <TaskTab />
          </div>
        )}
        {vis.record && (
          <div style={{ display: activeTab === "record" ? "contents" : "none" }}>
            <RecordForm />
          </div>
        )}
        {vis.interruption && (
          <div style={{ display: activeTab === "interruption" ? "contents" : "none" }}>
            <InterruptionForm />
          </div>
        )}
        {vis.viewer && (
          <div style={{ display: activeTab === "viewer" ? "contents" : "none" }}>
            <ViewerPanel />
          </div>
        )}
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
