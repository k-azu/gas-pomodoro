import { expect, test } from "@playwright/test";
import { gotoApp, typeInEditor, waitForSyncComplete } from "./helpers/app";

async function gotoStandaloneTaskDocument(
  page: import("@playwright/test").Page,
  type: "project" | "case" | "task",
  id: string,
): Promise<void> {
  const query = new URLSearchParams({ view: "document", tab: "task", type, id });
  await page.goto(`/?${query.toString()}#tab=task&type=${type}&id=${id}`);
  await expect(page.locator("[data-standalone-document]")).toBeVisible();
}

test("アクティブな案件・タスクの単体表示にアーカイブ表示を出さない", async ({ page }) => {
  await gotoStandaloneTaskDocument(page, "case", "mock-case-1");
  await expect(page.getByText("React化", { exact: true })).toBeVisible();
  await expect(page.getByText("アーカイブ済み", { exact: true })).toHaveCount(0);

  await gotoStandaloneTaskDocument(page, "task", "mock-task-1");
  await expect(page.getByText("Phase 6: RecordForm実装", { exact: true })).toBeVisible();
  await expect(page.getByText("アーカイブ済み", { exact: true })).toHaveCount(0);
});

test("親だけがアーカイブ済みのタスクは単体表示でもアーカイブ表示する", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "gas-pomodoro:mock-document-server:v1",
      JSON.stringify({ "mock-task-9": { metadata: { isActive: true } } }),
    );
  });
  await gotoStandaloneTaskDocument(page, "task", "mock-task-9");

  await expect(page.getByText("レガシーCSS整理", { exact: true })).toBeVisible();
  await expect(page.getByText("アーカイブ済み", { exact: true })).toBeVisible();
});

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

test("別タブで確定した本文snapshotを全件再取得せず反映する", async ({ context, page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);

  const second = await context.newPage();
  await gotoApp(second);
  await typeInEditor(page, "別タブへ反映する本文");
  await page.locator("[data-id='mock-memo-2']").click();
  await expect(page.locator("[data-id='mock-memo-2']")).toHaveClass(/active/);

  await expect(second.locator(".ProseMirror")).toContainText("別タブへ反映する本文");
  const calls = await second.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData ?? 0).toBe(0);
});

test("別タブで確定したmetadata snapshotを全件再取得せず反映する", async ({ context, page }) => {
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
  expect(calls.getAllDocumentData ?? 0).toBe(0);
});

test("別タブで選択中文書がarchiveされてもdirty本文と編集権を維持する", async ({
  context,
  page,
}) => {
  const target = { hash: "tab=task&type=task&id=mock-task-1" };
  await gotoApp(page, target);
  await waitForSyncComplete(page);
  await typeInEditor(page, "別タブarchive後も保存する本文");

  const second = await context.newPage();
  await gotoApp(second, target);
  const statusField = second.locator("[class*='record-field']", { hasText: "ステータス" });
  await statusField.locator("[class*='item-picker-trigger']").click();
  await second.getByText("Archived", { exact: true }).click();

  await expect(page.getByText("アーカイブ済み", { exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".ProseMirror:visible")).toContainText("別タブarchive後も保存する本文");

  await page.evaluate(() => {
    (window as any).__testVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window as any).__testVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => {
      const server = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("gas-pomodoro:mock-document-server:v1") || "{}"),
      );
      return server["mock-task-1"]?.content ?? "";
    })
    .toContain("別タブarchive後も保存する本文");
});
