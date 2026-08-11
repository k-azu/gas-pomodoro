import assert from "node:assert/strict";
import test from "node:test";
import {
  documentSessionReducer,
  getDocumentConflict,
  getDocumentSyncStatus,
  initialDocumentSessionState,
  isDocumentReadOnly,
  type DocumentSessionState,
} from "./documentSessionModel";

const remote = {
  content: "remote content",
  revision: 3,
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function reduce(
  state: DocumentSessionState,
  ...events: Parameters<typeof documentSessionReducer>[1][]
) {
  return events.reduce(documentSessionReducer, state);
}

test("resolve中は読み取り専用のままローカルdirtyを保持する", () => {
  const state = reduce(
    initialDocumentSessionState,
    { type: "documentOpened", needsResolve: true },
    { type: "localSnapshotLoaded", dirty: true },
  );

  assert.equal(state.phase, "resolving");
  assert.deepEqual(state.sync, { kind: "dirty" });
  assert.equal(isDocumentReadOnly(state), true);
  assert.equal(getDocumentSyncStatus(state), "syncing");

  const resolved = documentSessionReducer(state, { type: "resolveSucceeded" });
  assert.equal(resolved.phase, "editable");
  assert.deepEqual(resolved.sync, { kind: "dirty" });
});

test("競合中の追加編集でもリモートスナップショットを失わない", () => {
  const conflicted = reduce(
    initialDocumentSessionState,
    { type: "documentOpened", needsResolve: false },
    { type: "localSnapshotLoaded", dirty: true },
    { type: "remoteConflictDetected", remote },
    { type: "localEdited" },
  );

  assert.equal(conflicted.sync.kind, "conflict");
  assert.deepEqual(getDocumentConflict(conflicted), remote);
  assert.equal(getDocumentSyncStatus(conflicted), "conflict");
});

test("競合解決は処理成功まで競合スナップショットを保持する", () => {
  const conflicted = reduce(
    { phase: "editable", sync: { kind: "clean" } },
    { type: "remoteConflictDetected", remote },
    { type: "conflictResolutionStarted", choice: "local" },
  );

  assert.equal(getDocumentSyncStatus(conflicted), "syncing");
  assert.deepEqual(getDocumentConflict(conflicted), remote);

  const failed = documentSessionReducer(conflicted, {
    type: "operationFailed",
    reason: "save",
    hasLocalChanges: true,
  });
  assert.equal(getDocumentSyncStatus(failed), "conflict");
  assert.deepEqual(getDocumentConflict(failed), remote);

  const committed = documentSessionReducer(failed, {
    type: "localSnapshotLoaded",
    dirty: false,
  });
  assert.deepEqual(committed, { phase: "editable", sync: { kind: "clean" } });
});

test("競合解決中の追加入力では解決処理を多重起動可能にしない", () => {
  const resolving = reduce(
    { phase: "editable", sync: { kind: "conflict", remote } },
    { type: "conflictResolutionStarted", choice: "local" },
    { type: "localEdited" },
  );

  assert.equal(resolving.sync.kind, "conflict");
  assert.equal(
    resolving.sync.kind === "conflict" ? resolving.sync.resolution : undefined,
    "keeping-local",
  );
  assert.equal(getDocumentSyncStatus(resolving), "syncing");
});

test("保存失敗はresolve中の読み取り専用状態を変更しない", () => {
  const failed = documentSessionReducer(
    { phase: "resolving", sync: { kind: "saving" } },
    { type: "operationFailed", reason: "save", hasLocalChanges: true },
  );

  assert.equal(failed.phase, "resolving");
  assert.equal(isDocumentReadOnly(failed), true);
  assert.deepEqual(failed.sync, { kind: "error", reason: "save", hasLocalChanges: true });
});

test("読み込み失敗だけが文書を編集不能にする", () => {
  const loadFailed = documentSessionReducer(initialDocumentSessionState, {
    type: "operationFailed",
    reason: "load",
    hasLocalChanges: false,
  });
  assert.equal(loadFailed.phase, "blocked");
  assert.equal(isDocumentReadOnly(loadFailed), true);

  const saveFailed = documentSessionReducer(
    { phase: "editable", sync: { kind: "dirty" } },
    { type: "operationFailed", reason: "save", hasLocalChanges: true },
  );
  assert.equal(saveFailed.phase, "editable");
  assert.equal(isDocumentReadOnly(saveFailed), false);
  assert.deepEqual(saveFailed.sync, {
    kind: "error",
    reason: "save",
    hasLocalChanges: true,
  });
});

test("リモート適用成功時に競合を解消する", () => {
  const applied = reduce(
    { phase: "editable", sync: { kind: "clean" } },
    { type: "remoteConflictDetected", remote },
    { type: "conflictResolutionStarted", choice: "remote" },
    { type: "localSnapshotLoaded", dirty: false },
  );

  assert.deepEqual(applied, { phase: "editable", sync: { kind: "clean" } });
  assert.equal(getDocumentConflict(applied), null);
  assert.equal(getDocumentSyncStatus(applied), "idle");
});

test("編集・保存開始・確定をdirtyからcleanへ遷移させる", () => {
  const dirty = reduce({ phase: "editable", sync: { kind: "clean" } }, { type: "localEdited" });
  assert.deepEqual(dirty.sync, { kind: "dirty" });

  const saving = documentSessionReducer(dirty, { type: "saveStarted" });
  assert.deepEqual(saving.sync, { kind: "saving" });
  assert.equal(getDocumentSyncStatus(saving), "syncing");

  const committed = documentSessionReducer(saving, {
    type: "localSnapshotLoaded",
    dirty: false,
  });
  assert.deepEqual(committed, { phase: "editable", sync: { kind: "clean" } });
});
