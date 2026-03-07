/**
 * Markdown モードとドキュメント切り替え
 *
 * ドキュメント切り替え時は常に WYSIWYG モードに戻る仕様。
 * Markdown モードでの編集内容はキャッシュに正しく保存される。
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbPut } from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
  switchToMarkdownMode,
  getRawEditorText,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1"; // "開発メモ"
const MEMO_2_ID = "mock-memo-2"; // "議事録"

test.describe("Markdown モードとドキュメント切り替え", () => {
  test("M1: ドキュメント切り替え後は WYSIWYG モードに戻り正しい内容が表示される", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 を開いて内容を入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ1テキスト");
    await page.waitForTimeout(300);

    // memo2 を開いて内容を入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ2テキスト");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替え
    await switchToMarkdownMode(page);
    const rawText = await getRawEditorText(page);
    expect(rawText).toContain("メモ2テキスト");

    // memo1 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // WYSIWYG で memo1 の内容が表示されている
    const text = await getEditorText(page);
    expect(text).toContain("メモ1テキスト");
    expect(text).not.toContain("メモ2テキスト");
  });

  test("M2: マークダウンモード → ドキュメント切り替え → Rich Text で正しい内容", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1, memo2 に内容を設定
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "リッチ確認用1");
    await page.waitForTimeout(300);

    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "リッチ確認用2");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替え
    await switchToMarkdownMode(page);

    // memo1 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // 既に WYSIWYG なので直接確認
    const text = await getEditorText(page);
    expect(text).toContain("リッチ確認用1");
    expect(text).not.toContain("リッチ確認用2");
  });

  test("M3: マークダウンモードで編集 → ドキュメント切り替え → 戻ると編集内容が保存されている", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 を開く
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "初期テキスト");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替えて編集
    await switchToMarkdownMode(page);
    const rawEditor = page.locator(".mdg-raw-editor");
    await rawEditor.click();
    // 末尾に追加
    await page.keyboard.press("End");
    await page.keyboard.insertText("\n追加行");
    await page.waitForTimeout(2500); // debounce flush を待つ

    // memo2 に切り替え → WYSIWYG に戻る（rawMarkdown が editor に同期されてからキャッシュ）
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);

    // memo1 に戻る → WYSIWYG でキャッシュが復元される
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // IDB に保存されているか確認
    const rec = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(rec.content).toContain("初期テキスト");
    expect(rec.content).toContain("追加行");
  });

  test("M4: キャッシュなし → IDB から読み込み → WYSIWYG で正しい内容", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 を開く（memo2 は未オープン → キャッシュなし）
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // memo2 の IDB に直接書き込み
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "# IDB見出し\n\nIDB本文テキスト";
    await idbPut(page, MEMO_STORE, record);

    // memo2 に切り替え（キャッシュなし → IDB 読み込み）
    await selectMemo(page, "議事録");
    await page.waitForTimeout(1000);

    // WYSIWYG で IDB の内容が表示されている
    const text = await getEditorText(page);
    expect(text).toContain("IDB見出し");
    expect(text).toContain("IDB本文テキスト");
  });

  test("M5: ドキュメント往復 → 両ドキュメントの内容が正しい", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 に入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "往復テスト1");
    await page.waitForTimeout(300);

    // memo2 に入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "往復テスト2");
    await page.waitForTimeout(300);

    // memo1 → memo2 → memo1 と往復（常に WYSIWYG）
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);
    let text = await getEditorText(page);
    expect(text).toContain("往復テスト1");

    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);
    text = await getEditorText(page);
    expect(text).toContain("往復テスト2");

    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);
    text = await getEditorText(page);
    expect(text).toContain("往復テスト1");
  });

  test("M6: Markdown で編集 → 切り替え → 再度 Markdown で正しい内容", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "マークダウン確認");
    await page.waitForTimeout(300);

    // Markdown モードに切り替え
    await switchToMarkdownMode(page);
    let rawText = await getRawEditorText(page);
    expect(rawText).toContain("マークダウン確認");

    // memo2 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);

    // memo1 に戻る → WYSIWYG
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // 再度 Markdown モードに切り替え → 正しい内容が表示される
    await switchToMarkdownMode(page);
    rawText = await getRawEditorText(page);
    expect(rawText).toContain("マークダウン確認");
  });
});
