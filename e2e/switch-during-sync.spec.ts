/**
 * 同期中ドキュメント切替の上書き問題テスト
 *
 * バグ: 同期中(resolve遅延中)にドキュメントを切替えると、エディタは前ドキュメントの
 * 内容を表示したまま、onChangeが新IDをキャプチャしている。この状態でtiptapの
 * onChangeが発火すると、前ドキュメントの内容が新ドキュメントのIDで保存される。
 *
 * 検証方法: mockDelay で resolve を遅延させ、切替直後のエディタ内容を確認する。
 */
import { test, expect } from "@playwright/test";
import { idbGet } from "./helpers/idb";
import { gotoApp, selectMemo, typeInEditor, waitForSyncComplete } from "./helpers/app";

const SYNC_TIMEOUT = 15_000;

/** 各メモ固有のキーワード（他メモに含まれない文字列） */
const MEMOS = [
  { name: "開発メモ", keyword: "今週のタスク" },
  { name: "議事録", keyword: "参加者" },
  { name: "設計ドキュメント", keyword: "アーキテクチャ" },
  { name: "デプロイ手順書", keyword: "前提条件" },
  { name: "バグトラッカー", keyword: "未解決" },
] as const;

test.describe("同期中のドキュメント切替", () => {
  test("切替直後に前ドキュメントの内容が表示されない", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "2000" } });

    const editor = page.locator(".ProseMirror");

    // memo1 を開いてサーバーコンテンツが表示されるまで待つ
    await selectMemo(page, "開発メモ");
    await expect(editor).toContainText("今週のタスク", { timeout: SYNC_TIMEOUT });

    // memo2 へ切替（同期開始、2秒遅延）
    await selectMemo(page, "議事録");

    // ★ 切替直後: エディタに「開発メモ」の内容が残っていてはいけない
    const textAfterSwitch = await editor.innerText();
    expect(textAfterSwitch).not.toContain("今週のタスク");
  });

  test("高速切替後のエディタ表示が最終ドキュメントの内容", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "2000" } });

    // memo1 → memo2 → memo3 を高速切替
    await selectMemo(page, "開発メモ");
    await selectMemo(page, "議事録");
    await selectMemo(page, "設計ドキュメント");

    const editor = page.locator(".ProseMirror");

    // 最終ドキュメントの内容が表示されるまで待つ
    await expect(editor).toContainText("アーキテクチャ", { timeout: SYNC_TIMEOUT });

    // 前のドキュメントの内容が混じっていないこと
    const text = await editor.innerText();
    expect(text).not.toContain("今週のタスク"); // 開発メモ固有
    expect(text).not.toContain("参加者"); // 議事録固有
  });

  test("全5メモを順番に開いて正しいコンテンツが表示される", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "2000" } });

    const editor = page.locator(".ProseMirror");

    for (const memo of MEMOS) {
      await selectMemo(page, memo.name);
      // サーバー同期完了後に正しいコンテンツが表示される
      await expect(editor).toContainText(memo.keyword, { timeout: SYNC_TIMEOUT });

      // 他メモのコンテンツが混じっていないこと
      const text = await editor.innerText();
      for (const other of MEMOS) {
        if (other.name !== memo.name) {
          expect(text, `「${memo.name}」に「${other.name}」の内容が混入`).not.toContain(
            other.keyword,
          );
        }
      }
    }
  });

  test("同期中に切替して戻る → 元メモの内容が保持される", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "2000" } });

    const editor = page.locator(".ProseMirror");

    // memo1 同期完了まで待つ
    await selectMemo(page, "開発メモ");
    await expect(editor).toContainText("今週のタスク", { timeout: SYNC_TIMEOUT });

    // memo2 へ切替（同期中）→ すぐ memo1 に戻る
    await selectMemo(page, "議事録");
    await selectMemo(page, "開発メモ");

    // memo1 のエディタ内容が表示されるまで待つ
    await expect(editor).toContainText("今週のタスク", { timeout: SYNC_TIMEOUT });

    // 議事録の内容が混じっていないこと
    const text = await editor.innerText();
    expect(text).not.toContain("参加者");
  });

  test("同期中に連続切替 → 2周目で全メモの内容が正しく復元される", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "2000" } });

    const editor = page.locator(".ProseMirror");

    // 1周目: 全メモを同期完了を待たず高速切替（最後だけ同期完了を待つ）
    for (let i = 0; i < MEMOS.length - 1; i++) {
      await selectMemo(page, MEMOS[i].name);
      // 同期完了を待たず次へ
    }
    // 最後のメモだけ同期完了を待つ
    const last = MEMOS[MEMOS.length - 1];
    await selectMemo(page, last.name);
    await expect(editor).toContainText(last.keyword, { timeout: SYNC_TIMEOUT });

    // 2周目: 全メモを再度開いて正しい内容が復元されるか確認
    for (const memo of MEMOS) {
      await selectMemo(page, memo.name);
      await expect(editor).toContainText(memo.keyword, { timeout: SYNC_TIMEOUT });

      const text = await editor.innerText();
      for (const other of MEMOS) {
        if (other.name !== memo.name) {
          expect(text, `2周目「${memo.name}」に「${other.name}」の内容が混入`).not.toContain(
            other.keyword,
          );
        }
      }
    }
  });

  test("E2: sync 中の高速切り替え → IDB 破壊されない", async ({ page }) => {
    const MEMO_STORE = "memos";
    const MEMO_1_ID = "mock-memo-1";
    const MEMO_2_ID = "mock-memo-2";

    // Seed distinct content in each memo
    await gotoApp(page);
    await waitForSyncComplete(page);

    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "DISTINCT_A");
    await page.waitForTimeout(2500); // Wait for debounce flush

    await selectMemo(page, "議事録");
    await typeInEditor(page, "DISTINCT_B");
    await page.waitForTimeout(2500); // Wait for debounce flush

    // Reload with delay → triggers async resolve
    // Override mock content to null so resolve keeps local IDB content
    // (without this, MOCK_CONTENT_BY_ID returns different content that overwrites typed text)
    await page.addInitScript(() => {
      (window as any).__mockContentOverride = null;
    });
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
