import { expect, test } from "@playwright/test";
import {
  gotoApp,
  selectMemo,
  setMockTransformOnLoadShouldFailOnce,
  typeInEditor,
  waitForSyncComplete,
} from "./helpers/app";

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

test("新規メモ作成中は元のEditorStateとメモUIを固定する", async ({ page }) => {
  await gotoApp(page, { params: { mockDelay: "800" } });
  await waitForSyncComplete(page);
  await typeInEditor(page, "作成前に保存する本文");

  await page.getByRole("button", { name: "メモを新規作成" }).click();
  const createDialog = page.getByRole("dialog", { name: "メモを新規作成" });
  await createDialog.getByLabel("メモ名").fill("新しいメモ");
  await createDialog.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByText("メモを処理中...", { exact: true })).toBeVisible();
  await expect(page.getByText("保存中...", { exact: true })).toHaveCount(0);
  const editor = page.locator(".ProseMirror:visible");
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.keyboard.insertText("作成待機中に失われる入力");

  await expect(page.getByText("新しいメモ", { exact: true })).toBeVisible();
  await expect(page.getByText("メモを処理中...", { exact: true })).not.toBeVisible();
  await selectMemo(page, "開発メモ");
  await expect(page.locator(".ProseMirror:visible")).toContainText("作成前に保存する本文");
  await expect(page.locator(".ProseMirror:visible")).not.toContainText("作成待機中に失われる入力");
});

test("dirtyなメモとタスクを独立して保持し、種類間遷移はACKを待たない", async ({ page }) => {
  await gotoApp(page, { params: { mockDelay: "800" } });
  await waitForSyncComplete(page);

  await expect(page.locator(".ProseMirror")).toHaveCount(1);
  await expect(page.locator(".ProseMirror:visible")).toHaveCount(1);
  await typeInEditor(page, "タスクへ移る前に保存する本文");

  const memoTab = page.getByRole("button", { name: "メモ", exact: true });
  const taskTab = page.getByRole("button", { name: "タスク", exact: true });
  await taskTab.click();
  await expect(taskTab).toHaveClass(/active/);
  let calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent ?? 0).toBe(0);

  await page.getByText("GAS Pomodoro", { exact: true }).click();
  await waitForSyncComplete(page);
  await expect(page.locator(".ProseMirror")).toHaveCount(2);
  await expect(page.locator(".ProseMirror:visible")).toHaveCount(1);

  await memoTab.click();
  await expect(memoTab).toHaveClass(/active/);
  await expect(page.locator(".ProseMirror:visible")).toContainText("タスクへ移る前に保存する本文");
  calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent ?? 0).toBe(0);
  expect(calls.getAllDocumentData ?? 0).toBe(0);
});

test("ページ非表示時はdirtyなメモとタスクを通常保存し、保存中も編集できる", async ({ page }) => {
  await gotoApp(page, {
    params: { mockDelay: "800" },
    hash: "tab=task&type=task&id=mock-task-1",
  });
  await waitForSyncComplete(page);
  await typeInEditor(page, "非表示で保存するタスク本文");

  await page.getByRole("button", { name: "メモ", exact: true }).click();
  await waitForSyncComplete(page);
  await typeInEditor(page, "非表示で保存するメモ本文");
  await page.evaluate(() => {
    (window as any).__testVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window as any).__testVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.locator('[data-status="syncing"]:visible')).toBeVisible();
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");
  await typeInEditor(page, "・保存開始後の追加入力");

  await expect
    .poll(async () => {
      const server = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("gas-pomodoro:mock-document-server:v1") || "{}"),
      );
      return {
        memo: server["mock-memo-1"]?.content ?? "",
        task: server["mock-task-1"]?.content ?? "",
      };
    })
    .toEqual({
      memo: expect.stringContaining("非表示で保存するメモ本文・保存開始後の追加入力"),
      task: expect.stringContaining("非表示で保存するタスク本文"),
    });
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");
});

test("保存中の追加入力を本文競合のlocal側に保持する", async ({ page }) => {
  await gotoApp(page, { params: { mockDelay: "800" } });
  await waitForSyncComplete(page);
  await typeInEditor(page, "競合前のlocal本文");
  await page.evaluate(async () => {
    const mock = await import("/lib/serverCall.ts");
    mock.setMockRemoteDocumentContentForTests("mock-memo-1", "別端末の新しい本文");
    (window as any).__testVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window as any).__testVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator('[data-status="syncing"]:visible')).toBeVisible();
  await typeInEditor(page, "・保存開始後の追加入力");

  const conflict = page.locator("[data-document-content-conflict]");
  await expect(conflict).toBeVisible();
  await expect(conflict.locator("textarea").nth(0)).toHaveValue(/競合前のlocal本文/);
  await expect(conflict.locator("textarea").nth(0)).toHaveValue(/保存開始後の追加入力/);
  await expect(conflict.locator("textarea").nth(1)).toHaveValue("別端末の新しい本文");

  await conflict.getByRole("button", { name: "このタブの本文で置換" }).click();
  await expect(conflict).not.toBeVisible();
  await expect
    .poll(async () => {
      const server = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("gas-pomodoro:mock-document-server:v1") || "{}"),
      );
      const content = server["mock-memo-1"]?.content ?? "";
      return {
        beforeConflict: content.includes("競合前のlocal本文"),
        afterSaveStarted: content.includes("保存開始後の追加入力"),
      };
    })
    .toEqual({ beforeConflict: true, afterSaveStarted: true });
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

test("メモとタスクの本文はそれぞれ最後の入力から15秒後に保存する", async ({ page }) => {
  await gotoApp(page, { hash: "tab=task&type=task&id=mock-task-1" });
  await waitForSyncComplete(page);
  await page.getByRole("button", { name: "メモ", exact: true }).click();
  await waitForSyncComplete(page);
  await page.clock.install();
  await page.locator(".ProseMirror:visible").click();
  await page.keyboard.insertText("15秒idle保存するメモ");
  await page.getByRole("button", { name: "タスク", exact: true }).click();
  await page.locator(".ProseMirror:visible").click();
  await page.keyboard.insertText("15秒idle保存するタスク");

  // Leave margin for the editor input event's own clock tick.
  await page.clock.fastForward(14_000);
  let calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent ?? 0).toBe(0);

  await page.clock.fastForward(1_100);
  await expect
    .poll(() => page.evaluate(() => window.__mockServerCallCounts?.putDocumentContent ?? 0))
    .toBe(2);
  calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.putDocumentContent).toBe(2);
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

test("初回本文変換の失敗中は編集させず、明示更新の成功後に復旧する", async ({ page }) => {
  await setMockTransformOnLoadShouldFailOnce(page);
  await gotoApp(page);

  const editor = page.locator(".ProseMirror:visible");
  await expect(page.getByText("同期エラー", { exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");

  await page.getByRole("button", { name: "更新", exact: true }).click();
  await waitForSyncComplete(page);
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toContainText("今週のタスク");
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

test("選択中taskのarchiveはEditorStateを維持し、本文を通常のCASで保存できる", async ({ page }) => {
  await gotoApp(page, {
    params: { mockDelay: "500" },
    hash: "tab=task&type=task&id=mock-task-1",
  });
  await waitForSyncComplete(page);
  await typeInEditor(page, "archive前に保存する本文");

  const statusField = page.locator("[class*='record-field']", { hasText: "ステータス" });
  await statusField.locator("[class*='item-picker-trigger']").click();
  await page.getByText("Archived", { exact: true }).click();

  await expect
    .poll(() => page.evaluate(() => window.__mockServerCallCounts?.patchDocumentMetadata ?? 0))
    .toBe(1);
  await expect(page.getByText("アーカイブ済み", { exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".ProseMirror:visible")).toContainText("archive前に保存する本文");
  await expect(
    page.locator("[class*='task-tree-task']", { hasText: "Phase 6: RecordForm実装" }),
  ).toHaveCount(0);

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
      return {
        content: server["mock-task-1"]?.content ?? "",
        isActive: server["mock-task-1"]?.metadata?.isActive,
      };
    })
    .toEqual({
      content: expect.stringContaining("archive前に保存する本文"),
      isActive: false,
    });
});

test("projectのarchiveは子を変更せず、archive一覧から開いて復元できる", async ({ page }) => {
  await gotoApp(page, { hash: "tab=task&type=task&id=mock-task-1" });
  await waitForSyncComplete(page);
  const project = page.locator("[data-type='project'][data-id='mock-proj-1']");
  await project.locator(":scope > div").click({ button: "right" });
  await page.getByText("アーカイブ", { exact: true }).click();

  await expect(project).toHaveCount(0);
  await expect(page.getByText("アーカイブ済み", { exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");

  const archivedProjects = page.locator("details", { hasText: "アーカイブ済みプロジェクト" });
  await archivedProjects.locator("summary").click();
  const archivedProject = archivedProjects.getByText("GAS Pomodoro", { exact: true });
  await expect(archivedProject).toBeVisible();
  await archivedProject.click();
  await expect(page.locator('input[value="GAS Pomodoro"]')).toBeVisible();
  await archivedProjects.getByRole("button", { name: "解除" }).click();

  await expect(project).toBeVisible();
  await project.locator("[class*='task-tree-toggle']").click();
  const taskCase = page.locator("[data-type='case'][data-id='mock-case-1']");
  await expect(taskCase).toBeVisible();
  await taskCase.locator("[class*='task-tree-toggle']").click();
  await expect(
    page.locator("[class*='task-tree-task']", { hasText: "Phase 6: RecordForm実装" }),
  ).toBeVisible();
});

test("metadata保存失敗を表示し、再送ACKまで文書遷移を止める", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);
  await page.evaluate(() => {
    window.__mockMetadataShouldFail = true;
  });

  const title = page.locator(".mdg-content-area:visible input").first();
  await title.click();
  await title.fill("未送信の名前");
  await title.press("Enter");
  await expect(page.getByText("同期エラー", { exact: true })).toBeVisible();

  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_1);
  await expect(title).toHaveValue("未送信の名前");

  await page.evaluate(() => {
    window.__mockMetadataShouldFail = false;
  });
  await page.locator(MEMO_2).click();
  await expectActive(page, MEMO_2);
});

test("metadata保存失敗中も画面タブだけは切り替えられる", async ({ page }) => {
  await gotoApp(page, { hash: "tab=task" });
  await expect(page.locator(".ProseMirror:visible")).toHaveCount(0);
  await page.evaluate(() => {
    window.__mockMetadataShouldFail = true;
  });
  const project = page.locator("[data-type='project'][data-id='mock-proj-1']");
  await project.locator(":scope > div").click({ button: "right" });
  await page.getByText("名前変更", { exact: true }).click();
  const renameInput = project.locator("input");
  await renameInput.fill("未送信のプロジェクト名");
  await renameInput.press("Enter");
  await expect(page.getByText("同期エラー", { exact: true })).toBeVisible();

  const memoTab = page.getByRole("button", { name: "メモ", exact: true });
  const taskTab = page.getByRole("button", { name: "タスク", exact: true });
  await memoTab.click();
  await expect(memoTab).toHaveClass(/active/);

  await page.evaluate(() => {
    window.__mockMetadataShouldFail = false;
  });
  await taskTab.click();
  await expect(taskTab).toHaveClass(/active/);
});

test("再取得中の更新通知を消費せず、完了後に追従再取得する", async ({ page }) => {
  await gotoApp(page, { params: { mockDelay: "500" } });
  await waitForSyncComplete(page);

  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "更新中...", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByRole("button", { name: "更新", exact: true })).toBeVisible({
    timeout: 5_000,
  });
  const calls = await page.evaluate(() => window.__mockServerCallCounts ?? {});
  expect(calls.getAllDocumentData).toBe(2);
});
