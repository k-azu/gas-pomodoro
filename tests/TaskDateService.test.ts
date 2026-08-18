import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function loadReadTaskDateValue() {
  const source = readFileSync(new URL("../src/TaskDateService.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const formatCalls: Array<{ timeZone: string; pattern: string }> = [];
  const context = {
    Utilities: {
      formatDate: (_value: Date, timeZone: string, pattern: string) => {
        formatCalls.push({ timeZone, pattern });
        return "2026-08-19";
      },
    },
  };
  runInNewContext(javascript, context);
  return { context, formatCalls };
}

test("Date型のタスク日付をSpreadsheetのタイムゾーンでYYYY-MM-DDへ変換する", () => {
  const { context, formatCalls } = loadReadTaskDateValue();
  const value = runInNewContext(
    'readTaskDateValue(new Date("2026-08-18T15:00:00.000Z"), "Asia/Tokyo")',
    context,
  );

  assert.equal(value, "2026-08-19");
  assert.deepEqual(formatCalls, [{ timeZone: "Asia/Tokyo", pattern: "yyyy-MM-dd" }]);
});

test("文字列のタスク日付は変更しない", () => {
  const { context, formatCalls } = loadReadTaskDateValue();
  const value = runInNewContext('readTaskDateValue("2026-08-19", "Asia/Tokyo")', context);

  assert.equal(value, "2026-08-19");
  assert.deepEqual(formatCalls, []);
});
