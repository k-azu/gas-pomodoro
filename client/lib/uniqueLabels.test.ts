import assert from "node:assert/strict";
import { test } from "node:test";
import { uniqueLabels } from "./uniqueLabels";

test("重複しないラベルはそのまま返す", () => {
  assert.deepEqual(uniqueLabels(["A", "B"]), ["A", "B"]);
});

test("重複には連番を付ける", () => {
  assert.deepEqual(uniqueLabels(["A", "A", "A"]), ["A", "A (2)", "A (3)"]);
});

test("連番が既存のラベルと衝突しない", () => {
  const labels = uniqueLabels(["A", "A", "A (2)"]);
  assert.deepEqual(labels, ["A", "A (3)", "A (2)"]);
  assert.equal(new Set(labels).size, labels.length);
});
