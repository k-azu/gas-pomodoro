/**
 * MemoTab — Memo sidebar + editor panel
 * Notion-like layout: toolbar(sticky) → meta → editor body in single scroll
 */
import { useState, useCallback } from "react";
import { useMemos } from "../../hooks/useMemos";
import type { MemoItem } from "../../hooks/useMemos";
import { useDocumentEditor } from "../../hooks/useDocumentEditor";
import { useEditorConfig } from "../../hooks/useEditorConfig";
import { Sidebar, InlineRename, SidebarExpandButton } from "../shared/Sidebar";
import { lsGet, lsSet } from "../../lib/localStorage";
import { ContextMenu } from "../shared/ContextMenu";
import type { ContextMenuSection } from "../shared/ContextMenu";
import { ItemPicker } from "../shared/ItemPicker";
import { ContentHeaderName } from "../shared/ContentHeader";
import { RecordField } from "../shared/RecordField";
import { MemoIcon } from "../shared/Icons";
import { DocumentEditor, ToolbarSlot, MetaTitle } from "../shared/DocumentEditor";
import { SyncIndicator } from "../shared/SyncIndicator";
import * as MemoStore from "../../lib/memoStore";
import s from "./MemoTab.module.css";

const SIDEBAR_KEY = "gas_pomodoro_memo_sidebar_collapsed";

export function MemoTab() {
  const memo = useMemos();
  const editorConfig = useEditorConfig();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => lsGet(SIDEBAR_KEY) === "1");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pos: { x: number; y: number };
    item: MemoItem;
  } | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const {
    editorRef,
    initialContent,
    onChange: handleEditorChange,
    syncStatus,
    readOnly,
  } = useDocumentEditor({
    id: memo.activeId || "",
    loadContent: useCallback((id: string) => MemoStore.getContent(id), []),
    saveContent: useCallback((id: string, md: string) => {
      MemoStore.saveContent(id, md);
    }, []),
    resolveContent: useCallback((id: string) => MemoStore.resolveWithServer(id), []),
    ...editorConfig.hookOptions,
  });

  const activeMemo = memo.memos.find((m) => m.id === memo.activeId);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      lsSet(SIDEBAR_KEY, next ? "1" : "");
      return next;
    });
  }, []);

  // Handle memo selection
  const handleSelect = useCallback(
    (id: string) => {
      if (id === memo.activeId) return;
      memo.selectMemo(id);
    },
    [memo],
  );

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, item: MemoItem) => {
    setContextMenu({ pos: { x: e.clientX, y: e.clientY }, item });
  }, []);

  const contextMenuSections: ContextMenuSection[] = contextMenu
    ? [
        {
          items: [
            {
              label: "名前変更",
              onClick: () => setRenamingId(contextMenu.item.id),
            },
            {
              label: "削除",
              danger: true,
              onClick: () => {
                if (confirm(`「${contextMenu.item.name}」を削除しますか？`)) {
                  memo.deleteMemo(contextMenu.item.id);
                }
              },
            },
          ],
        },
        {
          title: "タグ",
          items: [
            ...memo.tags.map((tag) => ({
              label: tag.name,
              dotColor: tag.color,
              checked: contextMenu.item.tags.includes(tag.name),
              onClick: () => {
                if (contextMenu.item.tags.includes(tag.name)) {
                  memo.removeTagFromMemo(contextMenu.item.id, tag.name);
                } else {
                  memo.addTagToMemo(contextMenu.item.id, tag.name);
                }
              },
            })),
            {
              label: "+ 新しいタグ",
              onClick: () => {
                const name = prompt("タグ名:");
                if (name?.trim()) {
                  memo.addTag(name.trim());
                  memo.addTagToMemo(contextMenu.item.id, name.trim());
                }
              },
            },
          ],
        },
      ]
    : [];

  // Tag filter for sidebar
  const usedTags = memo.tags.filter((tag) => memo.memos.some((m) => m.tags.includes(tag.name)));

  const extraFilter = activeTagFilter
    ? (item: MemoItem) => item.tags.includes(activeTagFilter!)
    : undefined;

  // Sidebar filter slot
  const filterSlot =
    usedTags.length > 0 ? (
      <div className={s["memo-tag-filters"]}>
        <ItemPicker
          mode="single"
          items={usedTags}
          selected={activeTagFilter ? [activeTagFilter] : []}
          onSelect={(selected) => setActiveTagFilter(selected.length > 0 ? selected[0] : null)}
          placeholder="タグで絞り込み..."
          emptyLabel="タグ検索"
          compact
        />
      </div>
    ) : null;

  return (
    <div className={s["memo-tab-layout"]}>
      <Sidebar<MemoItem>
        items={memo.memos}
        activeId={memo.activeId}
        onSelect={handleSelect}
        onAdd={memo.createMemo}
        renderItem={(item) =>
          renamingId === item.id ? (
            <InlineRename
              initialValue={item.name}
              onCommit={(name) => {
                memo.renameMemo(item.id, name);
                setRenamingId(null);
              }}
              onCancel={() => setRenamingId(null)}
            />
          ) : (
            <MemoSidebarItem item={item} tags={memo.tags} />
          )
        }
        onReorder={memo.reorderMemos}
        onContextMenu={handleContextMenu}
        searchFilter={(item, q) => item.name.toLowerCase().includes(q)}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        emptyLabel="メモがありません"
        extraFilter={extraFilter}
        filterSlot={filterSlot}
      />

      <div className={s["memo-editor-panel"]}>
        {activeMemo ? (
          initialContent !== null ? (
            <DocumentEditor
              {...editorConfig.editorProps}
              initialValue={initialContent}
              documentId={memo.activeId || undefined}
              onChange={handleEditorChange}
              placeholder="メモを入力..."
              editorRef={editorRef}
              readOnly={readOnly}
              toolbarLeft={
                sidebarCollapsed ? (
                  <ToolbarSlot>
                    <SidebarExpandButton onClick={toggleSidebar} />
                  </ToolbarSlot>
                ) : undefined
              }
              toolbarRight={
                syncStatus !== "idle" && syncStatus !== "synced" ? (
                  <ToolbarSlot>
                    <SyncIndicator status={syncStatus} />
                  </ToolbarSlot>
                ) : undefined
              }
            >
              <MetaTitle>
                <ContentHeaderName
                  name={activeMemo.name}
                  onRename={(name) => memo.renameMemo(activeMemo.id, name)}
                  renaming={renamingId === activeMemo.id}
                  onRenameEnd={() => setRenamingId(null)}
                />
              </MetaTitle>
              <RecordField label="タグ">
                <ItemPicker
                  mode="multi"
                  items={memo.tags}
                  selected={activeMemo.tags}
                  onSelect={(selected) => memo.updateTags(activeMemo.id, selected)}
                  onCreateItem={(name, color) => memo.addTag(name, color)}
                  onColorChange={memo.updateTagColor}
                  placeholder="タグを検索 / 作成..."
                />
              </RecordField>
            </DocumentEditor>
          ) : null
        ) : (
          <>
            {sidebarCollapsed && (
              <div className={s["empty-header"]}>
                <SidebarExpandButton onClick={toggleSidebar} />
              </div>
            )}
            <div className={s["empty-state"]}>
              <p>メモを選択するか、新規作成してください</p>
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          position={contextMenu.pos}
          sections={contextMenuSections}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function MemoSidebarItem({
  item,
  tags,
}: {
  item: MemoItem;
  tags: { name: string; color: string }[];
}) {
  return (
    <>
      <MemoIcon size={16} />
      <span className={s["memo-item-name"]}>{item.name}</span>
      {item.tags.length > 0 && (
        <span className={s["memo-item-tags"]}>
          {item.tags.map((tagName) => {
            const tag = tags.find((t) => t.name === tagName);
            return (
              <span
                key={tagName}
                className="memo-tag-dot"
                style={{ background: tag?.color || "#757575" }}
              />
            );
          })}
        </span>
      )}
    </>
  );
}
