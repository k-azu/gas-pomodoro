/**
 * TaskStore — facade over EntityStore for project/case/task CRUD
 * Port of TaskStore.html IIFE → TypeScript module.
 */

import * as EntityStore from "./entityStore";
import { serverCall } from "./serverCall";
import type { TaskStatus } from "../types/entities";

const STATUS_ORDER: Record<string, number> = {
  docs: 0,
  doing: 1,
  review: 2,
  todo: 3,
  pending: 4,
  done: 5,
};

// =========================================================
// Init: register entity types and start sync
// =========================================================

export function init(): Promise<void> {
  EntityStore.register("projects", {
    entityType: "project",
    keyPath: "id",
    indexes: [],
    serverFns: {
      add: "addProject",
      update: "updateProject",
      archive: "archiveProject",
      getContent: "getProjectContent",
      reorder: "reorderProjects",
    },
    addServerArgs: (e: any) => [e.id, e.name, e.color || "#4285f4"],
  });

  EntityStore.register("cases", {
    entityType: "case",
    keyPath: "id",
    indexes: [{ name: "projectId", keyPath: "projectId", options: { unique: false } }],
    serverFns: {
      add: "addCase",
      update: "updateCase",
      archive: "archiveCase",
      getContent: "getCaseContent",
      reorder: "reorderCases",
    },
    addServerArgs: (e: any) => [e.id, e.projectId, e.name],
  });

  EntityStore.register("tasks", {
    entityType: "task",
    keyPath: "id",
    indexes: [
      { name: "projectId", keyPath: "projectId", options: { unique: false } },
      { name: "caseId", keyPath: "caseId", options: { unique: false } },
      { name: "status", keyPath: "status", options: { unique: false } },
    ],
    serverFns: {
      add: "addTask",
      update: "updateTask",
      archive: "archiveTask",
      getContent: "getTaskContent",
      reorder: "reorderTasks",
    },
    addServerArgs: (e: any) => [e.id, e.projectId, e.caseId || "", e.name],
    onUpdateHook: (item: any, fields: Record<string, any>) => {
      if (fields.status === "done" && item.status !== "done") {
        fields.completedAt = new Date().toISOString();
      } else if (fields.status && fields.status !== "done" && item.status === "done") {
        fields.completedAt = "";
      }
    },
  });

  return EntityStore.init("gas_pomodoro", 3, {
    onUpgrade: (db) => {
      if (db.objectStoreNames.contains("contents")) db.deleteObjectStore("contents");
      if (db.objectStoreNames.contains("syncMeta")) db.deleteObjectStore("syncMeta");
    },
  }).then(() => {
    // Phase 2: async server sync (not awaited — UI renders from IDB immediately)
    serverCall("getAllTaskData")
      .then((data: any) =>
        Promise.all([
          EntityStore.mergeServerData("projects", data.projects || []),
          EntityStore.mergeServerData("cases", data.cases || []),
          EntityStore.mergeServerData("tasks", data.tasks || []),
        ]),
      )
      .then(() => {
        EntityStore.requeueDirtyRecords("projects");
        EntityStore.requeueDirtyRecords("cases");
        EntityStore.requeueDirtyRecords("tasks");
        EntityStore.emit("dataChanged", { entityType: "all", op: "serverSync" });
      })
      .catch((err) => {
        console.warn("[TaskStore] server sync failed, using IDB cache:", err);
      });
  });
}

// =========================================================
// CRUD
// =========================================================

export function addProject(name: string, color?: string): Promise<string> {
  return EntityStore.addEntity("projects", {
    id: crypto.randomUUID(),
    name,
    color: color || "#4285f4",
  });
}

export function addCase(projectId: string, name: string): Promise<string> {
  return EntityStore.addEntity("cases", {
    id: crypto.randomUUID(),
    projectId,
    name,
  });
}

export function addTask(projectId: string, caseId: string, name: string): Promise<string> {
  return EntityStore.addEntity("tasks", {
    id: crypto.randomUUID(),
    projectId,
    caseId: caseId || "",
    name,
    status: "todo" as TaskStatus,
    completedAt: "",
    startedAt: "",
    dueDate: "",
  });
}

export function updateProject(id: string, fields: Record<string, any>): Promise<void> {
  return EntityStore.updateEntityFields("projects", id, fields);
}

export function updateCase(id: string, fields: Record<string, any>): Promise<void> {
  return EntityStore.updateEntityFields("cases", id, fields);
}

export function updateTask(id: string, fields: Record<string, any>): Promise<void> {
  return EntityStore.updateEntityFields("tasks", id, fields);
}

// =========================================================
// Archive (with cascading for project/case)
// =========================================================

export function archiveProject(id: string): Promise<void> {
  return EntityStore.setInactive("projects", id)
    .then(() =>
      EntityStore.getByIndex("cases", "projectId", id).then((cases) =>
        Promise.all(cases.map((c) => EntityStore.setInactive("cases", c.id))),
      ),
    )
    .then(() =>
      EntityStore.getByIndex("tasks", "projectId", id).then((tasks) =>
        Promise.all(tasks.map((t) => EntityStore.setInactive("tasks", t.id))),
      ),
    )
    .then(() => {
      EntityStore.emit("dataChanged", { entityType: "project", op: "archive", id });
      EntityStore.syncArchiveToServer("projects", id);
    });
}

export function archiveCase(id: string): Promise<void> {
  return EntityStore.setInactive("cases", id)
    .then(() =>
      EntityStore.getByIndex("tasks", "caseId", id).then((tasks) =>
        Promise.all(tasks.map((t) => EntityStore.setInactive("tasks", t.id))),
      ),
    )
    .then(() => {
      EntityStore.emit("dataChanged", { entityType: "case", op: "archive", id });
      EntityStore.syncArchiveToServer("cases", id);
    });
}

export function archiveTask(id: string): Promise<void> {
  return EntityStore.archiveEntity("tasks", id);
}

// =========================================================
// Query helpers
// =========================================================

export function getProjects(): Promise<any[]> {
  return EntityStore.getAll("projects").then((items) =>
    items
      .filter((p) => p.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
  );
}

export function getCases(projectId: string): Promise<any[]> {
  return EntityStore.getByIndex("cases", "projectId", projectId).then((items) =>
    items
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
  );
}

export function getTasks(projectId: string, caseId?: string): Promise<any[]> {
  const indexName = caseId ? "caseId" : "projectId";
  const indexVal = caseId || projectId;
  return EntityStore.getByIndex("tasks", indexName, indexVal).then((items) =>
    items
      .filter((t) => {
        if (t.isActive === false) return false;
        if (caseId) return true;
        return !t.caseId;
      })
      .sort((a, b) => {
        const sa = STATUS_ORDER[a.status] !== undefined ? STATUS_ORDER[a.status] : 99;
        const sb = STATUS_ORDER[b.status] !== undefined ? STATUS_ORDER[b.status] : 99;
        if (sa !== sb) return sa - sb;
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      }),
  );
}

export function getAllProjects(): Promise<any[]> {
  return getProjects();
}

export function getAllCases(): Promise<any[]> {
  return EntityStore.getAll("cases").then((items) =>
    items.filter((c) => c.isActive !== false),
  );
}

export function getAllTasks(): Promise<any[]> {
  return EntityStore.getAll("tasks").then((items) =>
    items.filter((t) => t.isActive !== false),
  );
}

// =========================================================
// Reorder
// =========================================================

export function reorderProjects(orderedIds: string[]): Promise<void> {
  const entries = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
  return EntityStore.updateSortOrders("projects", entries).then(() => {
    EntityStore.emit("dataChanged", { entityType: "project", op: "reorder" });
    EntityStore.scheduleReorderSync("projects", [orderedIds]);
  });
}

export function reorderCases(projectId: string, orderedIds: string[]): Promise<void> {
  const entries = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
  return EntityStore.updateSortOrders("cases", entries).then(() => {
    EntityStore.emit("dataChanged", { entityType: "case", op: "reorder" });
    EntityStore.scheduleReorderSync("cases", [projectId, orderedIds]);
  });
}

export function reorderTasks(parentId: string, orderedIds: string[]): Promise<void> {
  const entries = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
  return EntityStore.updateSortOrders("tasks", entries).then(() => {
    EntityStore.emit("dataChanged", { entityType: "task", op: "reorder" });
    EntityStore.scheduleReorderSync("tasks", [parentId, orderedIds]);
  });
}

// =========================================================
// Content
// =========================================================

export function saveContent(id: string, content: string, storeName: string): Promise<void> {
  return EntityStore.saveContent(storeName, id, content);
}

export function getContent(id: string, storeName: string): Promise<string | null> {
  return EntityStore.getContent(storeName, id);
}

export function resolveWithServer(id: string, storeName: string) {
  return EntityStore.resolveWithServer(storeName, id);
}

export function flushContentSync(storeName: string, id: string): void {
  EntityStore.flushContentSync(storeName, id);
}

// Re-export EntityStore methods used by TaskTab
export const on = EntityStore.on;
export const rawGet = EntityStore.get;
export const entityPut = EntityStore.put;
export const updateEntity = EntityStore.updateEntityRaw;
export const entityUpdateSortOrders = EntityStore.updateSortOrders;
export const entityFlushAllSyncs = EntityStore.flushAllSyncs;
export { withLock } from "./entityStore";
