import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMetadataMutation } from "./editPermissions";

test("Web Locks非対応時は対象に関係なくメタデータ変更を拒否する", () => {
  assert.equal(
    evaluateMetadataMutation("memos:other", {
      metadataReadOnly: true,
      activeDocumentKey: "memos:active",
      activeDocumentReadOnly: false,
    }),
    false,
  );
});

test("編集権を持たない選択中文書のメタデータ変更を拒否する", () => {
  assert.equal(
    evaluateMetadataMutation("tasks:active", {
      metadataReadOnly: false,
      activeDocumentKey: "tasks:active",
      activeDocumentReadOnly: true,
    }),
    false,
  );
});

test("Web Locks対応時は非選択文書または編集権を持つ文書を変更できる", () => {
  const state = {
    metadataReadOnly: false,
    activeDocumentKey: "tasks:active",
    activeDocumentReadOnly: true,
  };
  assert.equal(evaluateMetadataMutation("tasks:other", state), true);
  assert.equal(
    evaluateMetadataMutation("tasks:active", { ...state, activeDocumentReadOnly: false }),
    true,
  );
});
