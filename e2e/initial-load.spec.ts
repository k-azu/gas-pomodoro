import { expect, test } from "@playwright/test";
import { gotoApp, selectMemo, setMockContentOverride, waitForSyncComplete } from "./helpers/app";

test("初期化で文書本文を一括取得し、通常切り替えでは追加取得しない", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await expect(page.locator(".ProseMirror")).toContainText("今週のタスク");

  await selectMemo(page, "議事録");
  await expect(page.locator(".ProseMirror")).toContainText("週次ミーティング");
  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllInitData).toBe(1);
  expect(calls.getMemoContent ?? 0).toBe(0);
  expect(calls.getAllDocumentData ?? 0).toBe(0);
});

test("取得済みの空本文を未取得として扱わない", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await selectMemo(page, "空のメモ");
  await expect(page.locator(".ProseMirror")).toHaveText("");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
});

test("初期化されたMarkdownはundoでraw文字列や空本文へ戻らない", async ({ page }) => {
  await setMockContentOverride(page, {
    content: "# 初期見出し\n\n- **重要**: 初期本文",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });
  await gotoApp(page);
  await waitForSyncComplete(page);
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(editor).toContainText("初期見出し");
  await expect(editor).not.toContainText("# ");
});
