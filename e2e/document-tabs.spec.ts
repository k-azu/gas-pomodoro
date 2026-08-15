import { expect, test } from "@playwright/test";
import { gotoApp, typeInEditor, waitForSyncComplete } from "./helpers/app";

test("本文をACKしてから単体表示タブへ編集権を移譲する", async ({ context, page }) => {
  await gotoApp(page, { params: { mockDelay: "500" } });
  await waitForSyncComplete(page);
  await typeInEditor(page, "新しいタブへ渡す本文");

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "新しいタブ" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");

  await expect(popup.locator("[data-standalone-document]")).toBeVisible();
  await expect(popup.locator(".ProseMirror")).toContainText("新しいタブへ渡す本文");
  await expect(popup.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
  await expect(popup.locator("[class*='sidebar']")).toHaveCount(0);

  const popupCalls = await popup.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(popupCalls.getDocumentViewInitData).toBe(1);
  expect(popupCalls.getAllInitData ?? 0).toBe(0);

  await popup.close();
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true", {
    timeout: 5_000,
  });
});

test("同じ文書の本文を編集できるタブは一つだけ", async ({ context, page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);

  const second = await context.newPage();
  await gotoApp(second);
  await expect(second.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
});

test("非表示の選択中文書も編集権を保持する", async ({ context, page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await page.getByRole("button", { name: "タスク", exact: true }).click();

  const second = await context.newPage();
  await gotoApp(second);
  await expect(second.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await expect(second.getByText("別タブで本文編集中", { exact: true })).toBeVisible();
});

test("別タブで確定したmetadataをBroadcast後の再取得で反映する", async ({ context, page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);

  const second = await context.newPage();
  await gotoApp(second);
  const secondTitle = second.locator(".mdg-content-area input").first();
  await secondTitle.click();
  await secondTitle.fill("別タブで変更した名前");
  await secondTitle.press("Enter");

  await expect(page.locator(".mdg-content-area input").first()).toHaveValue(
    "別タブで変更した名前",
    { timeout: 5_000 },
  );
  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData).toBeGreaterThanOrEqual(1);
});
