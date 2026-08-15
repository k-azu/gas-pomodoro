import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasUnsavedDocument,
  registerDocumentEditGuard,
  requestDocumentTransition,
  runWithDocumentEditorFrozen,
  runWithDocumentKeyFrozen,
  runWithDocumentEditorsFrozen,
  type DocumentEditGuard,
} from "./documentNavigationGuard";

function guard(overrides: Partial<DocumentEditGuard> = {}): DocumentEditGuard {
  return {
    documentKey: crypto.randomUUID(),
    isDirty: () => false,
    saveBeforeTransition: async () => {},
    runWhileFrozen: async (operation) => operation(),
    ...overrides,
  };
}

test("文書遷移は指定された種類のEditorStateだけを保存する", async () => {
  let memoSaves = 0;
  let taskSaves = 0;
  const unregisterMemo = registerDocumentEditGuard(
    "memo",
    guard({
      isDirty: () => true,
      saveBeforeTransition: async () => {
        memoSaves += 1;
      },
    }),
  );
  const unregisterTask = registerDocumentEditGuard(
    "task",
    guard({
      isDirty: () => true,
      saveBeforeTransition: async () => {
        taskSaves += 1;
      },
    }),
  );

  try {
    let proceeded = false;
    assert.equal(
      await requestDocumentTransition("memo", () => {
        proceeded = true;
      }),
      true,
    );
    assert.equal(proceeded, true);
    assert.equal(memoSaves, 1);
    assert.equal(taskSaves, 0);
    assert.equal(hasUnsavedDocument(), true);
  } finally {
    unregisterMemo();
    unregisterTask();
  }
});

test("対象文書の更新は一致するEditorStateだけを固定する", async () => {
  const events: string[] = [];
  const makeGuard = (documentKey: string, name: string) =>
    guard({
      documentKey,
      runWhileFrozen: async (operation) => {
        events.push(`${name}:freeze`);
        try {
          return await operation();
        } finally {
          events.push(`${name}:unfreeze`);
        }
      },
    });
  const unregisterMemo = registerDocumentEditGuard("memo", makeGuard("memos:memo-1", "memo"));
  const unregisterTask = registerDocumentEditGuard("task", makeGuard("tasks:task-1", "task"));

  try {
    assert.equal(
      await runWithDocumentKeyFrozen("tasks:task-1", async () => {
        events.push("operation");
        return true;
      }),
      true,
    );
    assert.deepEqual(events, ["task:freeze", "operation", "task:unfreeze"]);
  } finally {
    unregisterMemo();
    unregisterTask();
  }
});

test("文書作成中は対象種類のEditorStateだけを固定し続ける", async () => {
  const events: string[] = [];
  const makeGuard = (name: string) =>
    guard({
      runWhileFrozen: async (operation) => {
        events.push(`${name}:freeze`);
        try {
          return await operation();
        } finally {
          events.push(`${name}:unfreeze`);
        }
      },
    });
  const unregisterMemo = registerDocumentEditGuard("memo", makeGuard("memo"));
  const unregisterTask = registerDocumentEditGuard("task", makeGuard("task"));

  try {
    assert.equal(
      await runWithDocumentEditorFrozen("memo", async () => {
        events.push("create:start");
        await Promise.resolve();
        events.push("create:end");
        return true;
      }),
      true,
    );
    assert.deepEqual(events, ["memo:freeze", "create:start", "create:end", "memo:unfreeze"]);
  } finally {
    unregisterMemo();
    unregisterTask();
  }
});

test("文書全体の操作はメモとタスクの両EditorStateを固定する", async () => {
  const events: string[] = [];
  const makeGuard = (name: string) =>
    guard({
      runWhileFrozen: async (operation) => {
        events.push(`${name}:freeze`);
        try {
          return await operation();
        } finally {
          events.push(`${name}:unfreeze`);
        }
      },
    });
  const unregisterMemo = registerDocumentEditGuard("memo", makeGuard("memo"));
  const unregisterTask = registerDocumentEditGuard("task", makeGuard("task"));

  try {
    assert.equal(
      await runWithDocumentEditorsFrozen(async () => {
        events.push("operation");
        return true;
      }),
      true,
    );
    assert.deepEqual(events, [
      "memo:freeze",
      "task:freeze",
      "operation",
      "task:unfreeze",
      "memo:unfreeze",
    ]);
  } finally {
    unregisterMemo();
    unregisterTask();
  }
});
