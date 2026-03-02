/**
 * E2E tests for document loading, switching, server sync, and persistence
 *
 * Test structure follows the document loading data flow:
 *   Step 1: Load local content (IDB or editor cache)
 *   Step 2: Server sync (resolveContent)
 *   Step 3: Conflict resolution (resolveContentConflict)
 *
 * Sections:
 *   A. 初回ロード — mount 時の IDB → エディタ表示
 *   B. ドキュメント切り替え — キャッシュ or IDB → switchDocument
 *   C. サーバー同期と競合解決 — resolveContent → resolveContentConflict
 *   D. コンテンツ永続化 — 入力 → IDB → リロード後復元
 *   E. エッジケース — エラー、レースコンディション
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbPut, clearDirtyAt } from "./helpers/idb";
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
const MEMO_2_ID = "mock-memo-2"; // "議事録"

// =========================================================
// A. 初回ロード
// =========================================================

test.describe("A. 初回ロード", () => {
  test("A1: IDB に内容あり → エディタに表示", async ({ page }) => {
    // Seed content into IDB by typing
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "初回ロードテスト");
    await page.waitForTimeout(500);

    // Reload → fresh initial load from IDB
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text).toContain("初回ロードテスト");
  });

  test("A2: IDB 空 → 空エディタ", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text.trim()).toBe("");
  });

  test("A3: syncing → readOnly → 完了後 editable", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "800" } });
    await selectMemo(page, "開発メモ");

    // During sync: syncing indicator visible + editor readOnly
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).toBeVisible({ timeout: 3_000 });
    const editor = page.locator(".ProseMirror");
    await expect(editor).toHaveAttribute("contenteditable", "false", { timeout: 3_000 });

    // After sync: editor editable
    await waitForSyncComplete(page);
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 3_000 });
  });

  // Known issue: tiptap-react v3 + React StrictMode の re-mount (setTimeout(0)) により、
  // onCreate の addToHistory:false dispatch 後に履歴エントリが混入する。
  test.fixme("A4: 初回ロード後の undo でマークダウン形式にならない", async ({ page }) => {
    // Seed markdown content in IDB
    await gotoApp(page);
    await waitForSyncComplete(page);
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    record.content = "# テスト見出し\n\n**太字テキスト**です";
    await idbPut(page, MEMO_STORE, record);

    // Reload → fresh initial load from IDB
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("太字テキスト", { timeout: 3_000 });

    // Press Ctrl+Z — should NOT revert to raw markdown
    await editor.click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Control+z");
    }
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).not.toContain("# ");
    expect(text).not.toContain("**");
  });
});

// =========================================================
// B. ドキュメント切り替え
// =========================================================

test.describe("B. ドキュメント切り替え", () => {
  test("B1: キャッシュなし → IDB から読み込み", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 first (memo2 has never been opened → no cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Seed content to memo2 directly in IDB
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "IDB直接書き込み";
    await idbPut(page, MEMO_STORE, record);

    // Switch to memo2 (no cache → reads from IDB)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text).toContain("IDB直接書き込み");
  });

  test("B2: キャッシュあり → IDB スキップ + キャッシュ復元", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 and type (creates editor cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "キャッシュ内容");
    await page.waitForTimeout(500);

    // Switch to memo2 (saves memo1 EditorState to cache)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    // Modify memo1 content directly in IDB (simulate external change)
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    record.content = "IDB上書き内容";
    await idbPut(page, MEMO_STORE, record);

    // Switch back to memo1 (cache hit → IDB skipped)
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("キャッシュ内容", {
      timeout: 3_000,
    });

    // Verify IDB-modified content is NOT shown
    const text = await getEditorText(page);
    expect(text).not.toContain("IDB上書き内容");
  });

  test("B3: 往復で両ドキュメントの内容保持", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Type in memo1
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ1の内容");
    await page.waitForTimeout(300);

    // Type in memo2
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ2の内容");
    await page.waitForTimeout(300);

    // Switch back to memo1
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("メモ1の内容", {
      timeout: 3_000,
    });

    // Verify both in IDB
    const rec1 = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    const rec2 = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    expect(rec1.content).toContain("メモ1の内容");
    expect(rec2.content).toContain("メモ2の内容");
  });

  test("B4: 同セッション再選択 → resolve スキップ", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "500" } });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Switch away and back
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");

    // Should NOT show syncing (_syncedIds prevents re-resolve)
    await page.waitForTimeout(300);
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).not.toBeVisible();
  });

  test("B5: キャッシュなし切り替え後の undo でマークダウン形式にならない", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 (memo2 is never opened → no cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Seed markdown content to memo2 in IDB
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "# 議事録タイトル\n\n- **重要**: ポイント1";
    await idbPut(page, MEMO_STORE, record);

    // Switch to memo2 (no cache → reads from IDB, EditorState.create resets history)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("重要", { timeout: 3_000 });

    // Press Ctrl+Z — should NOT revert to raw markdown
    await editor.click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Control+z");
    }
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).not.toContain("# ");
    expect(text).not.toContain("**");
  });

  test("B6: キャッシュあり切り替え後の undo で入力が取り消される", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 and type (creates undo history + editor cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "取り消しテスト");
    await page.waitForTimeout(300);

    // Switch to memo2 (saves memo1 EditorState with undo history to cache)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    // Switch back to memo1 (cache hit → undo history restored)
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("取り消しテスト", {
      timeout: 3_000,
    });

    // Press Ctrl+Z enough times to undo all typed characters
    const editor = page.locator(".ProseMirror");
    await editor.click();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Control+z");
    }
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).not.toContain("取り消しテスト");
  });
});

// =========================================================
// C. サーバー同期と競合解決
// =========================================================

test.describe("C. サーバー同期と競合解決", () => {
  test("C1: サーバー null → ローカル維持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "ローカルコンテンツ");
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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
    await page.waitForTimeout(500);

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

    // Reload clears _syncedIds
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");

    // Syncing should reappear after reload
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).toBeVisible({ timeout: 3_000 });
    await waitForSyncComplete(page);
  });
});

// =========================================================
// D. コンテンツ永続化
// =========================================================

test.describe("D. コンテンツ永続化", () => {
  test("D1: 入力 → IDB 保存 + _contentDirtyAt 設定", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "永続化テスト");
    await page.waitForTimeout(500);

    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("永続化テスト");
    expect(record._contentDirtyAt).not.toBeNull();
  });

  test("D2: リロード後 IDB から復元", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "リロード生存テスト");
    await page.waitForTimeout(500);

    // Reload
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await waitForSyncComplete(page);

    // Verify IDB preserved
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("リロード生存テスト");

    // Verify editor displays it
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const text = await getEditorText(page);
    expect(text).toContain("リロード生存テスト");
  });
});

// =========================================================
// E. エッジケース
// =========================================================

test.describe("E. エッジケース", () => {
  test("E1: サーバーエラー → error indicator + 内容保持", async ({ page }) => {
    // Seed content
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "エラーテスト");
    await page.waitForTimeout(500);

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

  test("E2: sync 中の高速切り替え → IDB 破壊されない", async ({ page }) => {
    // Seed distinct content in each memo
    await gotoApp(page);
    await waitForSyncComplete(page);

    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "DISTINCT_A");
    await page.waitForTimeout(500);

    await selectMemo(page, "議事録");
    await typeInEditor(page, "DISTINCT_B");
    await page.waitForTimeout(500);

    // Reload with delay → triggers async resolve
    await page.goto("/?mockDelay=1000#tab=memo");
    await page.waitForSelector("[class*='sidebar']", { timeout: 15_000 });

    // Rapid switch during sync — triggers stale callback race
    await selectMemo(page, "開発メモ");
    await selectMemo(page, "議事録");

    await waitForSyncComplete(page);
    await page.waitForTimeout(1500);

    // Verify IDB is NOT corrupted
    const idb1 = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    const idb2 = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    expect(idb1.content).toContain("DISTINCT_A");
    expect(idb2.content).toContain("DISTINCT_B");
    expect(idb1.content).not.toBe(idb2.content);
  });
});
