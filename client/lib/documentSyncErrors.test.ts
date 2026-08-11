import assert from "node:assert/strict";
import test from "node:test";
import { isDocumentSyncErrorCurrent, type DocumentSyncErrorEvent } from "./documentSyncErrors";

const transient: DocumentSyncErrorEvent = {
  storeName: "memos",
  id: "memo-1",
  error: new Error("offline"),
  mutationId: "mutation-1",
};

test("同じDraft世代の一時エラーだけを現在のエラーとして扱う", () => {
  assert.equal(
    isDocumentSyncErrorCurrent(transient, { source: "draft", mutationId: "mutation-1" }),
    true,
  );
  assert.equal(
    isDocumentSyncErrorCurrent(transient, { source: "draft", mutationId: "mutation-2" }),
    false,
  );
  assert.equal(isDocumentSyncErrorCurrent(transient, { source: "committed" }), false);
});

test("Recoveryへ移した終端エラーはActive Draft消去後も表示対象にする", () => {
  assert.equal(
    isDocumentSyncErrorCurrent({ ...transient, terminal: true }, { source: "committed" }),
    true,
  );
});
