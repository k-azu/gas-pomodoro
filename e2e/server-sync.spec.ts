/**
 * C. サーバー同期と競合解決 — resolveContent → resolveContentConflict
 * E1. サーバーエラー
 */
import { test, expect, type Page } from "@playwright/test";
import {
  idbGetAll,
  idbGetDocumentContent,
  idbDelete,
  clearDirtyAt,
  idbSeedDirtyContent,
} from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
  setMockContentOverride,
  setMockContentShouldFail,
  setMockLocalSaveShouldFailOnce,
  setMockLocalLoadShouldFailOnce,
  setMockTransformOnLoadShouldFailOnce,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1"; // "開発メモ"

async function waitForCommittedContent(page: Page, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
        return record.draft === null && record.content.includes(expected);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe("C. サーバー同期と競合解決", () => {
  test("C1: サーバー null → ローカル維持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカルコンテンツ");
    await waitForCommittedContent(page, "ローカルコンテンツ");

    // Clear dirty flag + set mock to null
    await clearDirtyAt(page, MEMO_STORE, MEMO_1_ID);
    await setMockContentOverride(page, null);

    // Reload → resolve returns null → local preserved
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("ローカルコンテンツ");
  });

  test("C2: サーバー内容あり + dirty なし → サーバー適用", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカル内容");
    await waitForCommittedContent(page, "ローカル内容");

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

    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
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

    // Model a local edit that has not reached the server yet.
    await idbSeedDirtyContent(page, MEMO_STORE, MEMO_1_ID, "ローカル未同期");
    await setMockContentOverride(page, {
      content: "サーバー内容",
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("ローカル未同期");
  });

  test("C4: サーバー = ローカル → _serverUpdatedAt 更新のみ", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "同一コンテンツ");
    await waitForCommittedContent(page, "同一コンテンツ");

    // Get exact content from IDB
    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
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

    const after = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(after.content).toBe(localContent);
    expect(after.body.updatedAt).toBe(serverTs);
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

  test("C7: サーバー上書き後に undo で IDB 内容に戻せる", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカルの内容");
    await waitForCommittedContent(page, "ローカルの内容");

    // Clear dirty flag so resolve applies server content
    await clearDirtyAt(page, MEMO_STORE, MEMO_1_ID);

    // Mock server with different content
    await setMockContentOverride(page, {
      content: "サーバーで上書きされた内容",
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Server content should be displayed
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("サーバーで上書きされた内容", { timeout: 5_000 });

    // Ctrl+Z should undo the server overwrite and restore IDB content
    await editor.click();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).toContain("ローカルの内容");
    expect(text).not.toContain("サーバーで上書きされた内容");
  });

  test("C8: サーバー内容の変換反映が終わってから editable になる", async ({ page }) => {
    await setMockContentOverride(page, {
      content: [
        "# サーバー画像遅延",
        "",
        "![slow](https://drive.google.com/file/d/mock-image-delay/view)",
        "",
        "反映後に編集可",
      ].join("\n"),
      updatedAt: new Date().toISOString(),
    });

    await gotoApp(page, { params: { mockImageDelay: "1200" } });

    // サイドバー表示後にエンティティを削除し、IDB に内容がない状態からサーバー内容を反映させる
    await idbDelete(page, MEMO_STORE, MEMO_1_ID);
    await selectMemo(page, "開発メモ");

    const editor = page.locator(".ProseMirror");
    await expect(page.locator('[data-status="syncing"]')).toBeVisible({ timeout: 3_000 });
    await expect(editor).toHaveAttribute("contenteditable", "false", { timeout: 3_000 });

    // getImageBase64 が遅延中。resolveComplete だけで editable に戻ってはいけない。
    await page.waitForTimeout(500);
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await expect(editor).toContainText("反映後に編集可", { timeout: 5_000 });
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 3_000 });
  });

  test("C9: ローカル保存失敗後も次回保存で内容が失われない", async ({ page }) => {
    await setMockLocalSaveShouldFailOnce(page);
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");

    await typeInEditor(page, "保存失敗後も残る");
    await page.waitForTimeout(2500);

    let record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).not.toContain("保存失敗後も残る");

    await typeInEditor(page, " 再保存");
    await expect
      .poll(async () => {
        record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
        return record.content.includes("保存失敗後も残る") && record.content.includes("再保存");
      })
      .toBe(true);
  });

  test("C9b: 文書切替時の保存失敗を自動再試行する", async ({ page }) => {
    await setMockLocalSaveShouldFailOnce(page);
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");

    await typeInEditor(page, "非表示でも再送される");
    await selectMemo(page, "議事録");
    await expect
      .poll(async () => {
        const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
        return record.content;
      })
      .toContain("非表示でも再送される");
  });

  test("C10: load 変換失敗時は raw 内容を表示し IDB 内容も消えない", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ロード失敗前の内容");
    await waitForCommittedContent(page, "ロード失敗前の内容");

    await setMockTransformOnLoadShouldFailOnce(page);
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");

    const editor = page.locator(".ProseMirror");
    await expect(page.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 3_000 });
    await expect(editor).toContainText("ロード失敗前の内容", { timeout: 3_000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-status="error"]')).toBeVisible();

    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("ロード失敗前の内容");
  });

  test("C11: 一時的なIDB load失敗から再読込し、内容を上書きしない", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "IDBロード失敗前の内容");
    await waitForCommittedContent(page, "IDBロード失敗前の内容");

    await setMockLocalLoadShouldFailOnce(page);
    await page.reload();
    await page.waitForSelector(".ProseMirror", { timeout: 10_000 });

    const editor = page.locator(".ProseMirror");
    await expect(page.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 5_000 });
    await expect(editor).toContainText("IDBロード失敗前の内容");

    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("IDBロード失敗前の内容");
  });

  test("E1: サーバーエラー → error indicator + 内容保持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "エラーテスト");
    await waitForCommittedContent(page, "エラーテスト");

    // Force error on reload
    await setMockContentShouldFail(page, true);
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");

    // Error indicator should appear
    const errorIndicator = page.locator('[data-status="error"]');
    await expect(errorIndicator).toBeVisible({ timeout: 10_000 });

    // Content should still be in IDB
    const record = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("エラーテスト");
  });

  test("E2: 保存の終端エラーを表示し、拒否された本文を保持する", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_1_ID);
    await page.evaluate(
      ({ content, revision }) => {
        localStorage.setItem(
          "gas_pomodoro_mock_server_content_mock-memo-1",
          JSON.stringify({
            content,
            contentRevision: revision,
            updatedAt: new Date().toISOString(),
            isActive: false,
          }),
        );
      },
      {
        content: String(before.body.content || ""),
        revision: Math.max(1, Number(before.body.revision) || 1),
      },
    );

    const marker = `terminal-save-error-${Date.now()}`;
    await typeInEditor(page, marker);

    await expect(page.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });
    const recoveryDrafts = await idbGetAll(page, "recoveryDocumentDrafts");
    expect(recoveryDrafts.some((draft) => String(draft.content).includes(marker))).toBe(true);
  });

  test("E3: 一時的な送信失敗後に追加入力なしで自動再試行する", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    await page.evaluate(() => {
      (window as any).__mockContentShouldFail = true;
    });
    const marker = `retry-after-transient-error-${Date.now()}`;
    await typeInEditor(page, marker);
    await expect(page.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() => {
      (window as any).__mockContentShouldFail = false;
    });
    await waitForCommittedContent(page, marker);
    await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  });
});
