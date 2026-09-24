import assert from "node:assert/strict";
import { test } from "node:test";
import { getDueState, isDueBeforeStart } from "./taskDueState";

const TODAY = "2026-09-24";

test("期限切れ・今日・未来を判定する", () => {
  assert.equal(getDueState({ status: "todo", dueDate: "2026-09-23" }, TODAY), "overdue");
  assert.equal(getDueState({ status: "doing", dueDate: "2026-09-24" }, TODAY), "today");
  assert.equal(getDueState({ status: "todo", dueDate: "2026-09-25" }, TODAY), null);
  assert.equal(getDueState({ status: "todo", dueDate: "" }, TODAY), null);
});

test("完了とドキュメントは期限切れにしない", () => {
  assert.equal(getDueState({ status: "done", dueDate: "2026-09-01" }, TODAY), null);
  assert.equal(getDueState({ status: "docs", dueDate: "2026-09-01" }, TODAY), null);
});

test("ISO 形式の日時は日付部分で比較する", () => {
  assert.equal(
    getDueState({ status: "todo", dueDate: "2026-09-24T15:00:00.000Z" }, TODAY),
    "today",
  );
});

test("期限が開始日より前かを判定する", () => {
  assert.equal(isDueBeforeStart({ startedAt: "2026-09-10", dueDate: "2026-09-09" }), true);
  assert.equal(isDueBeforeStart({ startedAt: "2026-09-10", dueDate: "2026-09-10" }), false);
  assert.equal(isDueBeforeStart({ startedAt: "", dueDate: "2026-09-09" }), false);
  assert.equal(isDueBeforeStart({ startedAt: "2026-09-10", dueDate: "" }), false);
});
