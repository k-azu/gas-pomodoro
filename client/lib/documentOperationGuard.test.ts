import assert from "node:assert/strict";
import test from "node:test";
import { DocumentOperationGuard } from "./documentOperationGuard";

test("文書切り替え後は古い非同期処理を無効化する", () => {
  const guard = new DocumentOperationGuard();
  const first = guard.start("memos:first");
  const second = guard.start("memos:second");

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test("同じ文書のeffect再実行でも古い世代を無効化する", () => {
  const guard = new DocumentOperationGuard();
  const first = guard.start("memos:same");
  const second = guard.start("memos:same");

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.capture("memos:same"), second);

  guard.finish(first);
  assert.equal(guard.isCurrent(second), true);

  guard.finish(second);
  assert.equal(guard.capture("memos:same"), null);
});
