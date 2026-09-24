import assert from "node:assert/strict";
import { test } from "node:test";
import { findBestScrollBlockIndex, type ModeScrollAnchor } from "./modeScrollAnchor";

function anchor(overrides: Partial<Extract<ModeScrollAnchor, { kind: "block" }>> = {}) {
  return {
    kind: "block" as const,
    blockIndex: 1,
    blockRatio: 0.5,
    textStart: "切り替え後も表示したい段落",
    textNear: "切り替え後も表示したい段落",
    fallbackRatio: 0.5,
    ...overrides,
  };
}

test("本文の一致をブロック番号より優先する", () => {
  const candidates = [
    { index: 0, text: "前の段落" },
    { index: 1, text: "Markdownで追加された段落" },
    { index: 2, text: "切り替え後も表示したい段落" },
  ];

  assert.equal(findBestScrollBlockIndex(candidates, anchor()), 2);
});

test("同じ本文が複数ある場合は元のブロック番号に近い方を選ぶ", () => {
  const candidates = [
    { index: 0, text: "切り替え後も表示したい段落" },
    { index: 1, text: "別の段落" },
    { index: 2, text: "切り替え後も表示したい段落" },
  ];

  assert.equal(findBestScrollBlockIndex(candidates, anchor({ blockIndex: 2 })), 2);
});

test("本文の手掛かりがない場合は元のブロック番号へフォールバックする", () => {
  const candidates = [
    { index: 0, text: "" },
    { index: 1, text: "" },
  ];

  assert.equal(
    findBestScrollBlockIndex(candidates, anchor({ blockIndex: 99, textStart: "", textNear: "" })),
    1,
  );
});
