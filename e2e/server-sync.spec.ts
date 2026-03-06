/**
 * C. サーバー同期と競合解決 — resolveContent → resolveContentConflict
 * E1. サーバーエラー
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbDelete, clearDirtyAt } from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
  setMockContentOverride,
  setMockContentShouldFail,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1"; // "開発メモ"

test.describe("C. サーバー同期と競合解決", () => {
  test("C1: サーバー null → ローカル維持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカルコンテンツ");
    await page.waitForTimeout(2500); // Wait for debounce flush

    // Clear dirty flag + set mock to null
    await clearDirtyAt(page, MEMO_STORE, MEMO_1_ID);
    await setMockContentOverride(page, null);

    // Reload → resolve returns null → local preserved
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("ローカルコンテンツ");
  });

  test("C2: サーバー内容あり + dirty なし → サーバー適用", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカル内容");
    await page.waitForTimeout(2500); // 2s debounce + margin

    // Clear dirty flag
    await clearDirtyAt(page, MEMO_STORE, MEMO_1_ID);

    // Mock server with different content
    await setMockContentOverride(page, {
      content: "サーバーコンテンツ",
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toBe("サーバーコンテンツ");
    const text = await getEditorText(page);
    expect(text).toContain("サーバーコンテンツ");
  });

  test("C3: サーバー内容あり + dirty あり → ローカル維持", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカル未同期");
    await page.waitForTimeout(2500); // Wait for debounce flush to IDB

    // Do NOT clear _contentDirtyAt — local has unsaved changes
    await setMockContentOverride(page, {
      content: "サーバー内容",
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("ローカル未同期");
  });

  test("C4: サーバー = ローカル → _serverUpdatedAt 更新のみ", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "同一コンテンツ");
    await page.waitForTimeout(2500); // 2s debounce + margin

    // Get exact content from IDB
    const before = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    const localContent = before.content;
    await clearDirtyAt(page, MEMO_STORE, MEMO_1_ID);

    // Return same content as local
    const serverTs = new Date().toISOString();
    await setMockContentOverride(page, {
      content: localContent,
      updatedAt: serverTs,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const after = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(after.content).toBe(localContent);
    expect(after._serverUpdatedAt).toBe(serverTs);
  });

  test("C5: リロード → セッションリセット → 再 resolve", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "500" } });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Reload clears _resolveStatus
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");

    // Syncing should reappear after reload
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).toBeVisible({ timeout: 3_000 });
    await waitForSyncComplete(page);
  });

  test("C6: エンティティ未存在 + サーバーにコンテンツあり → エディタに反映", async ({ page }) => {
    // mockDelay で resolve を遅延させ、その間にエンティティを削除する
    await gotoApp(page, { params: { mockDelay: "2000" } });

    // サイドバーが表示された時点でエンティティはIDBに存在する
    // メモ選択前にエンティティを削除 → resolve 時に entity=null → (C) パス
    await idbDelete(page, MEMO_STORE, MEMO_1_ID);

    // メモ選択 → loadContent=null, resolve 開始 (2秒遅延)
    await selectMemo(page, "開発メモ");

    // resolve 完了後、contentResolved イベント経由でサーバーコンテンツが表示される
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("今週のタスク", { timeout: 15_000 });
    await waitForSyncComplete(page);
  });

  test("E1: サーバーエラー → error indicator + 内容保持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "エラーテスト");
    await page.waitForTimeout(2500); // Wait for debounce flush

    // Force error on reload
    await setMockContentShouldFail(page, true);
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");

    // Error indicator should appear
    const errorIndicator = page.locator('[data-status="error"]');
    await expect(errorIndicator).toBeVisible({ timeout: 10_000 });

    // Content should still be in IDB
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("エラーテスト");
  });
});
