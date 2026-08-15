import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Memo } from "../types/entities";
import {
  DocumentContentConflictError,
  get,
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
  await waitForMetadata("memos", "memo-1");

  assert.deepEqual(mutationIds, [mutationIds[0], mutationIds[0]]);
  assert.equal((get("memos", "memo-1") as Memo).name, "Retained");
  assert.equal(get("memos", "memo-1")?.metadataRevision, 1);
});
