import type { Case, Project, Task, TaskStatus } from "../types/entities";
import * as DocumentStore from "./documentStore";
import type { DocumentStoreName } from "./documentStore";
import { serverCall } from "./serverCall";

export const STATUS_ORDER: Record<string, number> = {
  docs: 0,
  doing: 1,
  review: 2,
  todo: 3,
  pending: 4,
  done: 5,
};

export async function init(): Promise<void> {}
export async function loadData(): Promise<void> {}

function nowEntityBase(id: string, name: string, sortOrder: number) {
  const now = new Date().toISOString();
  return {
    id,
    name,
    content: "",
    sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
  };
}

export async function addProject(name: string, color = "#4285f4"): Promise<string> {
  const id = crypto.randomUUID();
  const result = (await serverCall("addProject", id, name, color)) as { success?: boolean };
  if (!result?.success) throw new Error("プロジェクトを作成できませんでした");
  DocumentStore.putLocal("projects", {
    ...nowEntityBase(id, name, DocumentStore.getAll("projects").length + 1),
    color,
  } as Project);
  DocumentStore.notifyDocumentCollectionChanged();
  return id;
}

export async function addCase(projectId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  const result = (await serverCall("addCase", id, projectId, name)) as { success?: boolean };
  if (!result?.success) throw new Error("案件を作成できませんでした");
  DocumentStore.putLocal("cases", {
    ...nowEntityBase(id, name, DocumentStore.getAll("cases").length + 1),
    projectId,
  } as Case);
  DocumentStore.notifyDocumentCollectionChanged();
  return id;
}

export async function addTask(projectId: string, caseId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  const result = (await serverCall("addTask", id, projectId, caseId, name)) as {
    success?: boolean;
  };
  if (!result?.success) throw new Error("タスクを作成できませんでした");
  DocumentStore.putLocal("tasks", {
    ...nowEntityBase(id, name, DocumentStore.getAll("tasks").length + 1),
    projectId,
    caseId,
    status: "todo" as TaskStatus,
    completedAt: "",
    startedAt: "",
    dueDate: "",
  } as Task);
  DocumentStore.notifyDocumentCollectionChanged();
  return id;
}

async function updateMetadata(
  storeName: Exclude<DocumentStoreName, "memos">,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const previous = DocumentStore.get(storeName, id);
  if (!previous) throw new Error("文書が見つかりません");
  const normalizedPatch = { ...patch };
  if (storeName === "tasks" && patch.status !== undefined) {
    const oldStatus = (previous as Task).status;
    const newStatus = String(patch.status);
    if (newStatus === "done" && oldStatus !== "done") {
      normalizedPatch.completedAt = new Date().toISOString();
    } else if (newStatus !== "done" && oldStatus === "done") {
      normalizedPatch.completedAt = "";
    }
  }
  DocumentStore.updateLocal(storeName, id, normalizedPatch);
  try {
    await DocumentStore.patchMetadata(storeName, id, patch);
  } catch (error) {
    console.error("[TaskStore] Metadata remains pending", error, previous.id);
    throw error;
  }
}

export function updateProject(id: string, fields: Record<string, unknown>): Promise<void> {
  return updateMetadata("projects", id, fields);
}

export function updateCase(id: string, fields: Record<string, unknown>): Promise<void> {
  return updateMetadata("cases", id, fields);
}

export function updateTask(id: string, fields: Record<string, unknown>): Promise<void> {
  return updateMetadata("tasks", id, fields);
}

async function archiveOne(
  storeName: Exclude<DocumentStoreName, "memos">,
  id: string,
): Promise<void> {
  await DocumentStore.waitForMetadata(storeName, id);
  if (DocumentStore.get(storeName, id)?.isActive === false) return;
  await DocumentStore.patchMetadata(storeName, id, { isActive: false });
}

export async function archiveProject(id: string): Promise<void> {
  await archiveOne("projects", id);
}

export async function archiveCase(id: string): Promise<void> {
  await archiveOne("cases", id);
}

export function archiveTask(id: string): Promise<void> {
  return archiveOne("tasks", id);
}

async function reactivateOne(
  storeName: Exclude<DocumentStoreName, "memos">,
  id: string,
): Promise<void> {
  await DocumentStore.waitForMetadata(storeName, id);
  if (DocumentStore.get(storeName, id)?.isActive === true) return;
  await DocumentStore.patchMetadata(storeName, id, { isActive: true });
}

export function unarchiveCase(id: string): Promise<void> {
  return reactivateOne("cases", id);
}

export function unarchiveProject(id: string): Promise<void> {
  return reactivateOne("projects", id);
}

export async function unarchiveTask(id: string, status?: TaskStatus): Promise<void> {
  await reactivateOne("tasks", id);
  if (status) await updateMetadata("tasks", id, { status });
}

export async function adjustTaskStats(
  taskId: string,
  timeDelta: number,
  countDelta: number,
): Promise<void> {
  const task = DocumentStore.get("tasks", taskId) as Task | null;
  if (!task) return;
  DocumentStore.updateLocal("tasks", taskId, {
    _cachedTimeSeconds: (task._cachedTimeSeconds ?? 0) + timeDelta,
    _cachedPomodoroCount: (task._cachedPomodoroCount ?? 0) + countDelta,
  });
}

export async function getProjects(): Promise<Project[]> {
  return (DocumentStore.getAll("projects") as Project[])
    .filter((project) => project.isActive !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export async function getCases(projectId: string): Promise<Case[]> {
  return (DocumentStore.getByIndex("cases", "projectId", projectId) as Case[])
    .filter((item) => item.isActive !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function compareTasks(left: Task, right: Task): number {
  const status = (STATUS_ORDER[left.status] ?? 99) - (STATUS_ORDER[right.status] ?? 99);
  if (status !== 0) return status;
  return left.createdAt.localeCompare(right.createdAt);
}

export async function getTasks(projectId: string, caseId?: string): Promise<Task[]> {
  const tasks = DocumentStore.getByIndex(
    "tasks",
    caseId ? "caseId" : "projectId",
    caseId || projectId,
  ) as Task[];
  return tasks
    .filter((task) => task.isActive !== false && (caseId ? true : !task.caseId))
    .sort(compareTasks);
}

export function getAllProjects(): Promise<Project[]> {
  return getProjects();
}

export async function getAllCases(): Promise<Case[]> {
  const activeProjectIds = new Set(
    (DocumentStore.getAll("projects") as Project[])
      .filter((project) => project.isActive !== false)
      .map((project) => project.id),
  );
  return (DocumentStore.getAll("cases") as Case[]).filter(
    (item) => item.isActive !== false && activeProjectIds.has(item.projectId),
  );
}

export async function getAllTasks(): Promise<Task[]> {
  const activeProjectIds = new Set(
    (DocumentStore.getAll("projects") as Project[])
      .filter((project) => project.isActive !== false)
      .map((project) => project.id),
  );
  const activeCaseIds = new Set(
    (DocumentStore.getAll("cases") as Case[])
      .filter((item) => item.isActive !== false && activeProjectIds.has(item.projectId))
      .map((item) => item.id),
  );
  return (DocumentStore.getAll("tasks") as Task[]).filter(
    (item) =>
      item.isActive !== false &&
      activeProjectIds.has(item.projectId) &&
      (!item.caseId || activeCaseIds.has(item.caseId)),
  );
}

export async function getArchivedCases(projectId: string): Promise<Case[]> {
  return (DocumentStore.getByIndex("cases", "projectId", projectId) as Case[]).filter(
    (item) => item.isActive === false,
  );
}

export async function getArchivedProjects(): Promise<Project[]> {
  return (DocumentStore.getAll("projects") as Project[])
    .filter((project) => project.isActive === false)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export async function getArchivedDirectTasks(projectId: string): Promise<Task[]> {
  return (DocumentStore.getByIndex("tasks", "projectId", projectId) as Task[]).filter(
    (item) => item.isActive === false && !item.caseId,
  );
}

export async function getArchivedTasksForCase(caseId: string): Promise<Task[]> {
  return (DocumentStore.getByIndex("tasks", "caseId", caseId) as Task[]).filter(
    (item) => item.isActive === false,
  );
}

export async function getTasksForArchivedCase(caseId: string): Promise<Task[]> {
  return DocumentStore.getByIndex("tasks", "caseId", caseId) as Task[];
}

async function reorder(
  storeName: Exclude<DocumentStoreName, "memos">,
  functionName: string,
  args: unknown[],
  ids: string[],
): Promise<void> {
  DocumentStore.reorderLocal(storeName, ids);
  const result = (await serverCall(functionName, ...args)) as { success?: boolean };
  if (!result?.success) throw new Error("並び順を保存できませんでした");
  DocumentStore.notifyDocumentCollectionChanged();
}

export function reorderProjects(ids: string[]): Promise<void> {
  return reorder("projects", "reorderProjects", [ids], ids);
}

export function reorderCases(projectId: string, ids: string[]): Promise<void> {
  return reorder("cases", "reorderCases", [projectId, ids], ids);
}

export function reorderTasks(parentId: string, ids: string[]): Promise<void> {
  return reorder("tasks", "reorderTasks", [parentId, ids], ids);
}

export function saveContent(
  id: string,
  content: string,
  storeName: string,
  _opts?: { immediateSync?: boolean },
): Promise<void> {
  return DocumentStore.saveContent(storeName as DocumentStoreName, id, content).then(
    () => undefined,
  );
}

export async function getContent(id: string, storeName: string): Promise<string | null> {
  const entity = DocumentStore.get(storeName as DocumentStoreName, id);
  if (entity) return entity.content;
  const functionName =
    storeName === "cases"
      ? "getCaseContent"
      : storeName === "tasks"
        ? "getTaskContent"
        : "getProjectContent";
  const snapshot = (await serverCall(functionName, id)) as { content?: string } | null;
  return snapshot ? String(snapshot.content ?? "") : null;
}

export async function resolveWithServer(
  _id?: string,
  _storeName?: string,
): Promise<{ useServer: boolean }> {
  return { useServer: false };
}

export function flushContentSync(_storeName?: string, _id?: string): void {}

export const on = DocumentStore.on;
export const rawGet = async (storeName: string, id: string) =>
  DocumentStore.get(storeName as DocumentStoreName, id);
