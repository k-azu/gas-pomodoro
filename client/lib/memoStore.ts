import type { Memo, MemoTag, MemoMetadata } from "../types";
import * as DocumentStore from "./documentStore";
import { serverCall } from "./serverCall";

let memoTags: MemoTag[] = [];

export function init(_serverMemos: MemoMetadata[], serverMemoTags: MemoTag[]): void {
  memoTags = serverMemoTags.map((tag) => ({ ...tag }));
}

export async function loadData(): Promise<void> {}

export async function getMemos(): Promise<Memo[]> {
  return (DocumentStore.getAll("memos") as Memo[])
    .filter((memo) => memo.isActive !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export async function getMemo(id: string): Promise<Memo | null> {
  return DocumentStore.get("memos", id) as Memo | null;
}

export async function addMemo(name: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = (await serverCall("saveMemo", { id, name, content: "", tags: [] })) as {
    success?: boolean;
  };
  if (!result?.success) throw new Error("メモを作成できませんでした");
  const sortOrder = DocumentStore.getAll("memos").length + 1;
  DocumentStore.putLocal("memos", {
    id,
    name,
    content: "",
    tags: [],
    sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
  } as Memo);
  DocumentStore.notifyServerConfirmed();
  return id;
}

async function updateMemoMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
  const previous = DocumentStore.get("memos", id);
  if (!previous) throw new Error("メモが見つかりません");
  DocumentStore.updateLocal("memos", id, patch);
  try {
    await DocumentStore.patchMetadata("memos", id, patch);
  } catch (error) {
    console.error("[MemoStore] Metadata remains pending", error, previous.id);
    throw error;
  }
}

export function renameMemo(id: string, name: string): Promise<void> {
  return updateMemoMetadata(id, { name });
}

export async function deleteMemo(id: string): Promise<void> {
  await DocumentStore.waitForMetadata("memos", id);
  await DocumentStore.patchMetadata("memos", id, { isActive: false });
}

export async function reorderMemos(orderedIds: string[]): Promise<void> {
  DocumentStore.reorderLocal("memos", orderedIds);
  const result = (await serverCall("updateMemoSortOrders", orderedIds)) as { success?: boolean };
  if (!result?.success) throw new Error("メモの並び順を保存できませんでした");
  DocumentStore.notifyServerConfirmed();
}

export function updateTags(id: string, tags: string[]): Promise<void> {
  return updateMemoMetadata(id, { tags });
}

export function addTag(name: string, color = "#757575"): void {
  if (memoTags.some((tag) => tag.name === name)) return;
  memoTags = [...memoTags, { name, color, sortOrder: memoTags.length + 1, isActive: true }];
  void serverCall("addMemoTag", name, color).catch((error) => {
    console.error("[MemoStore] Failed to add tag", error);
  });
}

export function updateTagColor(name: string, color: string): void {
  memoTags = memoTags.map((tag) => (tag.name === name ? { ...tag, color } : tag));
  void serverCall("updateMemoTagColor", name, color).catch((error) => {
    console.error("[MemoStore] Failed to update tag color", error);
  });
}

export function getTags(): MemoTag[] {
  return memoTags;
}

export function saveContent(
  id: string,
  content: string,
  _opts?: { immediateSync?: boolean },
): Promise<void> {
  return DocumentStore.saveContent("memos", id, content).then(() => undefined);
}

export async function getContent(id: string): Promise<string | null> {
  const memo = DocumentStore.get("memos", id);
  if (memo) return memo.content;
  const snapshot = (await serverCall("getMemoContent", id)) as { content?: string } | null;
  return snapshot ? String(snapshot.content ?? "") : null;
}

export async function resolveWithServer(_id?: string): Promise<{ useServer: boolean }> {
  return { useServer: false };
}

export function flushContentSync(_id?: string): void {}
