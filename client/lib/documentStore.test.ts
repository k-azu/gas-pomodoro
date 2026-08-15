import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Case, Memo, Project, Task } from "../types/entities";
import * as TaskStore from "./taskStore";
import {
  DocumentContentConflictError,
  get,
  hasAnyPendingMetadata,
  initialize,
  patchMetadata,
  saveContent,
  updateLocal,
  waitForMetadata,
} from "./documentStore";
import { setServerCallHandlerForTests } from "./serverCall";

function memo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "memo-1",
    name: "Memo",
    content: "server base",
    tags: [],
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
    ...overrides,
  };
}

beforeEach(() => {
  initialize({ memos: [memo()], projects: [], cases: [], tasks: [] });
});

afterEach(() => {
  setServerCallHandlerForTests(null);
});

test("本文ACK喪失後は同じmutation IDを再送する", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let applied: { content: string; mutationId: string } | null = null;
  setServerCallHandlerForTests((functionName, args) => {
    assert.equal(functionName, "putDocumentContent");
    const request = args[0] as {
      documentKey: string;
      content: string;
      expectedRevision: number;
      mutationId: string;
    };
    requests.push(request);
    if (!applied) {
      applied = { content: request.content, mutationId: request.mutationId };
      throw new Error("response lost");
    }
    assert.equal(request.mutationId, applied.mutationId);
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        content: applied.content,
        revision: 1,
        updatedAt: "2026-08-15T00:00:01.000Z",
        lastMutationId: applied.mutationId,
      },
    };
  });

  await assert.rejects(saveContent("memos", "memo-1", "local edit"), /response lost/);
  await saveContent("memos", "memo-1", "local edit");

  assert.equal(requests.length, 2);
  assert.equal(requests[0].mutationId, requests[1].mutationId);
  assert.equal(get("memos", "memo-1")?.content, "local edit");
  assert.equal(get("memos", "memo-1")?.contentRevision, 1);
});

test("古い本文revisionはremote snapshotを上書きしない", async () => {
  setServerCallHandlerForTests((_functionName, args) => {
    const request = args[0] as { documentKey: string; mutationId: string };
    return {
      status: "conflict",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        content: "new remote",
        revision: 2,
        updatedAt: "2026-08-15T00:00:02.000Z",
        lastMutationId: "other-device",
      },
    };
  });

  await assert.rejects(saveContent("memos", "memo-1", "stale local"), DocumentContentConflictError);
  assert.equal(get("memos", "memo-1")?.content, "server base");
  assert.equal(get("memos", "memo-1")?.contentRevision, 0);
});

test("metadata CAS競合後はremoteをbaseに同じpatchを再適用する", async () => {
  let callCount = 0;
  setServerCallHandlerForTests((_functionName, args) => {
    const request = args[0] as {
      documentKey: string;
      patch: Record<string, unknown>;
      expectedRevision: number;
      mutationId: string;
    };
    callCount += 1;
    if (callCount === 1) {
      assert.equal(request.expectedRevision, 0);
      return {
        status: "conflict",
        mutationId: request.mutationId,
        snapshot: {
          documentKey: request.documentKey,
          revision: 1,
          updatedAt: "2026-08-15T00:00:01.000Z",
          lastMutationId: "other-tab",
          metadata: { name: "Remote name", tags: ["remote"], isActive: true },
        },
      };
    }
    assert.equal(request.expectedRevision, 1);
    assert.deepEqual(request.patch, { name: "Local name" });
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        revision: 2,
        updatedAt: "2026-08-15T00:00:02.000Z",
        lastMutationId: request.mutationId,
        metadata: { name: "Local name", tags: ["remote"], isActive: true },
      },
    };
  });

  updateLocal("memos", "memo-1", { name: "Local name" });
  await patchMetadata("memos", "memo-1", { name: "Local name" });

  assert.equal(callCount, 2);
  assert.equal((get("memos", "memo-1") as Memo).name, "Local name");
  assert.deepEqual((get("memos", "memo-1") as Memo).tags, ["remote"]);
  assert.equal(get("memos", "memo-1")?.metadataRevision, 2);
});

test("metadata ACK喪失時も未確認patchとmutation IDを保持する", async () => {
  const mutationIds: string[] = [];
  setServerCallHandlerForTests((_functionName, args) => {
    const request = args[0] as {
      documentKey: string;
      patch: Record<string, unknown>;
      mutationId: string;
    };
    mutationIds.push(request.mutationId);
    if (mutationIds.length === 1) throw new Error("response lost");
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        revision: 1,
        updatedAt: "2026-08-15T00:00:01.000Z",
        lastMutationId: request.mutationId,
        metadata: { name: "Retained", tags: [], isActive: true },
      },
    };
  });

  updateLocal("memos", "memo-1", { name: "Retained" });
  await assert.rejects(patchMetadata("memos", "memo-1", { name: "Retained" }));
  assert.equal(hasAnyPendingMetadata(), true);
  await waitForMetadata("memos", "memo-1");

  assert.deepEqual(mutationIds, [mutationIds[0], mutationIds[0]]);
  assert.equal((get("memos", "memo-1") as Memo).name, "Retained");
  assert.equal(get("memos", "memo-1")?.metadataRevision, 1);
  assert.equal(hasAnyPendingMetadata(), false);
});

test("子文書のarchive ACK喪失後も同じmutationを再送し、親を最後にarchiveする", async () => {
  const parentProject: Project = {
    id: "project-1",
    name: "Project",
    content: "",
    color: "#4285f4",
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
  };
  const childCase: Case = {
    id: "case-1",
    projectId: "project-1",
    name: "Case",
    content: "",
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
  };
  const childTask: Task = {
    id: "task-1",
    projectId: "project-1",
    caseId: "case-1",
    name: "Task",
    content: "",
    status: "todo",
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    completedAt: "",
    startedAt: "",
    dueDate: "",
    contentRevision: 0,
    metadataRevision: 0,
    lastContentMutationId: "",
    lastMetadataMutationId: "",
  };
  initialize({ memos: [], projects: [parentProject], cases: [childCase], tasks: [childTask] });

  const calls: Array<{ documentKey: string; mutationId: string }> = [];
  const server = new Map<string, { isActive: boolean; revision: number; lastMutationId: string }>([
    ["projects:project-1", { isActive: true, revision: 0, lastMutationId: "" }],
    ["cases:case-1", { isActive: true, revision: 0, lastMutationId: "" }],
    ["tasks:task-1", { isActive: true, revision: 0, lastMutationId: "" }],
  ]);
  let loseTaskResponse = true;
  setServerCallHandlerForTests((functionName, args) => {
    assert.equal(functionName, "patchDocumentMetadata");
    const request = args[0] as {
      documentKey: string;
      patch: { isActive: boolean };
      expectedRevision: number;
      mutationId: string;
    };
    calls.push({ documentKey: request.documentKey, mutationId: request.mutationId });
    const state = server.get(request.documentKey)!;
    if (state.lastMutationId === request.mutationId) {
      return metadataResult(request, state);
    }
    assert.equal(request.expectedRevision, state.revision);
    state.isActive = request.patch.isActive;
    state.revision += 1;
    state.lastMutationId = request.mutationId;
    if (request.documentKey === "tasks:task-1" && loseTaskResponse) {
      loseTaskResponse = false;
      throw new Error("response lost");
    }
    return metadataResult(request, state);
  });

  await assert.rejects(TaskStore.archiveProject("project-1"), /response lost/);
  assert.equal(get("projects", "project-1")?.isActive, true);
  assert.equal(get("cases", "case-1")?.isActive, true);
  assert.equal(get("tasks", "task-1")?.isActive, true);

  await TaskStore.archiveProject("project-1");

  assert.deepEqual(
    calls.map((call) => call.documentKey),
    ["tasks:task-1", "tasks:task-1", "cases:case-1", "projects:project-1"],
  );
  assert.equal(calls[0].mutationId, calls[1].mutationId);
  assert.equal(get("tasks", "task-1")?.isActive, false);
  assert.equal(get("cases", "case-1")?.isActive, false);
  assert.equal(get("projects", "project-1")?.isActive, false);
});

test("archive済みtaskの復元はisActiveだけを先にCASし、その後statusを更新する", async () => {
  const archivedTask: Task = {
    id: "task-1",
    projectId: "project-1",
    caseId: "",
    name: "Task",
    content: "saved",
    status: "todo",
    sortOrder: 1,
    isActive: false,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    completedAt: "",
    startedAt: "",
    dueDate: "",
    contentRevision: 2,
    metadataRevision: 3,
    lastContentMutationId: "content-2",
    lastMetadataMutationId: "archive-3",
  };
  initialize({ memos: [], projects: [], cases: [], tasks: [archivedTask] });

  const patches: Array<Record<string, unknown>> = [];
  let revision = 3;
  let isActive = false;
  let status = "todo";
  setServerCallHandlerForTests((functionName, args) => {
    assert.equal(functionName, "patchDocumentMetadata");
    const request = args[0] as {
      documentKey: string;
      patch: Record<string, unknown>;
      expectedRevision: number;
      mutationId: string;
    };
    patches.push(request.patch);
    assert.equal(request.expectedRevision, revision);
    if (!isActive) assert.deepEqual(request.patch, { isActive: true });
    if (request.patch.isActive === true) isActive = true;
    if (typeof request.patch.status === "string") status = request.patch.status;
    revision += 1;
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        revision,
        updatedAt: `2026-08-15T00:00:0${revision}.000Z`,
        lastMutationId: request.mutationId,
        metadata: {
          projectId: "project-1",
          caseId: "",
          name: "Task",
          status,
          isActive,
          startedAt: "",
          dueDate: "",
          completedAt: "",
        },
      },
    };
  });

  await TaskStore.unarchiveTask("task-1", "doing");

  assert.deepEqual(patches, [{ isActive: true }, { status: "doing" }]);
  assert.equal(get("tasks", "task-1")?.isActive, true);
  assert.equal((get("tasks", "task-1") as Task).status, "doing");
});

function metadataResult(
  request: { documentKey: string; mutationId: string },
  state: { isActive: boolean; revision: number; lastMutationId: string },
) {
  return {
    status: "applied",
    mutationId: request.mutationId,
    snapshot: {
      documentKey: request.documentKey,
      revision: state.revision,
      updatedAt: "2026-08-15T00:00:01.000Z",
      lastMutationId: state.lastMutationId,
      metadata: { isActive: state.isActive },
    },
  };
}
