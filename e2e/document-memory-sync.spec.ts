import { expect, test } from "@playwright/test";
import { gotoApp, selectMemo, typeInEditor, waitForSyncComplete } from "./helpers/app";

const MEMO_1 = "[data-id='mock-memo-1']";
const MEMO_2 = "[data-id='mock-memo-2']";

async function expectActive(page: import("@playwright/test").Page, selector: string) {
  await expect(page.locator(selector)).toHaveClass(/active/);
}

test("取得済みclean文書の切り替えではサーバーを待たない", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);

  await selectMemo(page, "議事録");
  await expectActive(page, MEMO_2);
  await selectMemo(page, "開発メモ");
  await expectActive(page, MEMO_1);

  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData ?? 0).toBe(0);
  expect(calls.putDocumentContent ?? 0).toBe(0);
});

test("dirty文書は保存ACKまで選択を変えず、ACK後はメモリから復元する", async ({ page }) => {
  await gotoApp(page, { params: { mockDelay: "800" } });
  await waitForSyncComplete(page);
  await typeInEditor(page, "切替前に保存する本文");

  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_1);
  await expect(page.getByText("保存中...", { exact: true })).toBeVisible();
  await expectActive(page, MEMO_2);

  await page.locator(MEMO_1).click();
  await expectActive(page, MEMO_1);
  await expect(page.locator(".ProseMirror")).toContainText("切替前に保存する本文");

  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent).toBe(1);
  expect(calls.getAllDocumentData ?? 0).toBe(0);
});

test("本文は最後の入力から15秒後に保存する", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await page.clock.install();
  await page.locator(".ProseMirror").click();
  await page.keyboard.insertText("15秒idle保存");

  // Leave margin for the editor input event's own clock tick.
  await page.clock.fastForward(14_000);
  let calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent ?? 0).toBe(0);

  await page.clock.fastForward(1_100);
  await expect
    .poll(() => page.evaluate(() => window.__mockServerCallCounts?.putDocumentContent ?? 0))
    .toBe(1);
  calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent).toBe(1);
});

test("本文保存失敗時は遷移せずEditorStateを維持する", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await typeInEditor(page, "失敗しても残る本文");
  await page.evaluate(() => {
    window.__mockContentShouldFail = true;
  });

  await page.locator(MEMO_2).click();
  await expect(page.getByText("保存中...", { exact: true })).not.toBeVisible();
  await expectActive(page, MEMO_1);
  await expect(page.locator(".ProseMirror")).toContainText("失敗しても残る本文");

  await page.evaluate(() => {
    window.__mockContentShouldFail = false;
  });
  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_2);
});

test("古いrevisionは本文を上書きせず、localとserverを選べる", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await typeInEditor(page, "古い端末側の本文");
  await page.evaluate(async () => {
    const mock = await import("/lib/serverCall.ts");
    mock.setMockRemoteDocumentContentForTests("mock-memo-1", "別端末の新しい本文");
  });

  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_1);
  const conflict = page.locator("[data-document-content-conflict]");
  await expect(conflict).toBeVisible();
  await expect(conflict.locator("textarea").nth(0)).toHaveValue(/古い端末側の本文/);
  await expect(conflict.locator("textarea").nth(1)).toHaveValue("別端末の新しい本文");

  await conflict.getByRole("button", { name: "サーバーの本文を採用" }).click();
  await expect(conflict).not.toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText("別端末の新しい本文");
  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_2);
});

test("文書本文をIndexedDBへ作成しない", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await typeInEditor(page, "IDBには保存しない本文");
  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_2);

  const storeNames = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("gas_pomodoro", 4);
        request.onsuccess = () => resolve(Array.from(request.result.objectStoreNames));
        request.onerror = () => reject(request.error);
      }),
  );
  expect(storeNames).not.toContain("contents");
  expect(storeNames).not.toContain("syncMeta");
  expect(storeNames).not.toContain("memos");
  expect(storeNames).not.toContain("projects");
  expect(storeNames).not.toContain("cases");
  expect(storeNames).not.toContain("tasks");
});

test("明示的な更新でサーバー本文をバックグラウンド再取得する", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await page.evaluate(async () => {
    const mock = await import("/lib/serverCall.ts");
    mock.setMockRemoteDocumentContentForTests("mock-memo-1", "更新操作で取得する本文");
  });

  await page.getByRole("button", { name: "更新" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("更新操作で取得する本文");
  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData).toBe(1);
});

test("30分以上非表示だった場合だけ表示復帰時に再取得する", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await page.clock.install();
  await page.evaluate(() => {
    (window as any).__testVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window as any).__testVisibilityState,
    });
  });
  const setVisibility = async (state: "hidden" | "visible") => {
    await page.evaluate((nextState) => {
      (window as any).__testVisibilityState = nextState;
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  };

  await setVisibility("hidden");
  await page.clock.fastForward(29 * 60 * 1000);
  await setVisibility("visible");
  await page.clock.fastForward(500);
  let calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData ?? 0).toBe(0);

  await setVisibility("hidden");
  await page.clock.fastForward(30 * 60 * 1000);
  await setVisibility("visible");
  await page.clock.fastForward(500);
  await expect
    .poll(() => page.evaluate(() => window.__mockServerCallCounts?.getAllDocumentData ?? 0))
    .toBe(1);
  calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData).toBe(1);
});
