import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptRemoteDocument,
  applyRemoteDocument,
  applySaveAccepted,
  editDocument,
  keepLocalDocument,
  rejectDocumentDraft,
  selectDocumentContent,
  type DocumentContentState,
} from "./documentContentModel";

const committed = {
  key: "memos:memo-1",
  content: "server v1",
  revision: 1,
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function dirtyState(): DocumentContentState {
  return editDocument(
    { committed, draft: null },
    {
      content: "local edit",
      baseRevision: 1,
      allowRebase: false,
      localVersion: 1,
      mutationId: "mutation-1",
      updatedAt: "2026-08-11T00:01:00.000Z",
    },
  );
}

test("表示本文はDraftを優先し、versionTokenを正本の世代から導出する", () => {
  assert.deepEqual(selectDocumentContent({ committed, draft: null }), {
    content: "server v1",
    revision: 1,
    source: "committed",
    versionToken: "committed:1",
  });
  assert.deepEqual(selectDocumentContent(dirtyState()), {
    content: "local edit",
    revision: 1,
    source: "draft",
    versionToken: "pending:1:mutation-1:1",
  });
});

test("保存中の追加入力は古いACKで消さずbaseRevisionだけ進める", () => {
  const first = dirtyState();
  const editedAgain = editDocument(first, {
    content: "newer local edit",
    baseRevision: 1,
    allowRebase: false,
    localVersion: 2,
    mutationId: "mutation-2",
    updatedAt: "2026-08-11T00:02:00.000Z",
  });
  const accepted = applySaveAccepted(editedAgain, {
    requestMutationId: "mutation-1",
    content: "local edit",
    revision: 2,
    updatedAt: "2026-08-11T00:03:00.000Z",
  });

  assert.equal(accepted.committed.revision, 2);
  assert.deepEqual(accepted.draft, {
    kind: "pending",
    key: committed.key,
    content: "newer local edit",
    baseRevision: 2,
    mutationId: "mutation-2",
    localVersion: 2,
    updatedAt: "2026-08-11T00:02:00.000Z",
  });
});

test("入力後に進んだリモートrevisionへ暗黙にリベースしない", () => {
  const remote = {
    ...committed,
    content: "remote edit",
    revision: 2,
    updatedAt: "2026-08-11T00:02:00.000Z",
  };
  const state = editDocument(
    { committed: remote, draft: null },
    {
      content: "local edit",
      baseRevision: 1,
      allowRebase: false,
      localVersion: 1,
      mutationId: "mutation-2",
      updatedAt: "2026-08-11T00:03:00.000Z",
    },
  );

  assert.equal(state.draft?.kind, "conflict");
  assert.deepEqual(state.draft?.kind === "conflict" ? state.draft.remote : null, remote);
});

test("このページの先行ACKに限り未永続化入力を新revisionへリベースする", () => {
  const ownCommit = {
    ...committed,
    content: "first local edit",
    revision: 2,
    updatedAt: "2026-08-11T00:02:00.000Z",
    mutationId: "mutation-1",
  };
  const state = editDocument(
    { committed: ownCommit, draft: null },
    {
      content: "newer local edit",
      baseRevision: 1,
      allowRebase: true,
      localVersion: 1,
      mutationId: "mutation-2",
      updatedAt: "2026-08-11T00:03:00.000Z",
    },
  );

  assert.deepEqual(state.draft, {
    kind: "pending",
    key: committed.key,
    content: "newer local edit",
    baseRevision: 2,
    mutationId: "mutation-2",
    localVersion: 1,
    updatedAt: "2026-08-11T00:03:00.000Z",
  });
});

test("現在の確定revisionより古いACKではDraftを完了しない", () => {
  const state = dirtyState();
  const current = {
    ...state,
    committed: { ...committed, content: "server v3", revision: 3 },
  };
  const unchanged = applySaveAccepted(current, {
    requestMutationId: "mutation-1",
    content: "local edit",
    revision: 2,
    updatedAt: "2026-08-11T00:03:00.000Z",
  });

  assert.deepEqual(unchanged, current);
});

test("新しいリモート本文とローカルDraftを明示的な競合にする", () => {
  const conflicted = applyRemoteDocument(dirtyState(), {
    content: "server v2",
    revision: 2,
    updatedAt: "2026-08-11T00:03:00.000Z",
  });

  assert.equal(conflicted.draft?.kind, "conflict");
  assert.deepEqual(selectDocumentContent(conflicted), {
    content: "local edit",
    revision: 2,
    source: "draft",
    versionToken: "conflict:1:2",
    conflict: conflicted.committed,
  });

  const keepingLocal = keepLocalDocument(conflicted, "mutation-2", "2026-08-11T00:04:00.000Z");
  assert.deepEqual(keepingLocal.draft, {
    kind: "pending",
    key: committed.key,
    content: "local edit",
    baseRevision: 2,
    mutationId: "mutation-2",
    localVersion: 1,
    updatedAt: "2026-08-11T00:04:00.000Z",
  });
  assert.deepEqual(acceptRemoteDocument(conflicted), {
    committed: conflicted.committed,
    draft: null,
  });
  assert.deepEqual(acceptRemoteDocument(conflicted, 1), conflicted);
});

test("同じ本文がリモート確定済みならDraftを競合にせず解消する", () => {
  const resolved = applyRemoteDocument(dirtyState(), {
    content: "local edit",
    revision: 2,
    updatedAt: "2026-08-11T00:03:00.000Z",
  });

  assert.equal(resolved.draft, null);
  assert.equal(resolved.committed.revision, 2);
});

test("終端拒否はActive DraftからRecovery Draftへ移す", () => {
  const rejected = rejectDocumentDraft(dirtyState(), {
    reason: "inactive",
    recoveryId: "recovery-1",
    createdAt: "2026-08-11T00:05:00.000Z",
  });

  assert.equal(rejected.state.draft, null);
  assert.deepEqual(rejected.recovery, {
    recoveryId: "recovery-1",
    documentKey: committed.key,
    content: "local edit",
    createdAt: "2026-08-11T00:05:00.000Z",
    reason: "inactive",
  });
});
