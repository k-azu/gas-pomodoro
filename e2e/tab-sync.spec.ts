import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  gotoApp,
  selectMemo,
  setMockContentOverride,
  typeInEditor,
  waitForSyncComplete,
} from "./helpers/app";
import { idbDelete, idbGet, idbGetAll, idbGetDocumentContent, idbPut } from "./helpers/idb";

const MEMO_STORE = "memos";
const MEMO_ID = "mock-memo-1";
const MEMO_KEY = `${MEMO_STORE}:${MEMO_ID}`;

async function openSameMemo(context: BrowserContext, mockDelay?: string) {
  const pageA: Page = await context.newPage();
  const pageB: Page = await context.newPage();
  const options = mockDelay ? { params: { mockDelay } } : undefined;
  await Promise.all([gotoApp(pageA, options), gotoApp(pageB, options)]);
  await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);

  await expect
    .poll(async () => {
      const [aLocked, bLocked] = await Promise.all([
        pageA.locator('[data-status="locked"]').isVisible(),
        pageB.locator('[data-status="locked"]').isVisible(),
      ]);
      return Number(aLocked) + Number(bLocked);
    })
    .toBe(1);

  const pageALocked = await pageA.locator('[data-status="locked"]').isVisible();
  return {
    owner: pageALocked ? pageB : pageA,
    waiting: pageALocked ? pageA : pageB,
  };
}

test.describe("文書本文のタブ間調停", () => {
  test("同じ文書は一方だけが編集し、終了後に編集権を引き継ぐ", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    await expect(owner.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
    await expect(waiting.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");

    await owner.close();
    await expect(waiting.locator('[data-status="locked"]')).not.toBeVisible({ timeout: 5_000 });
    await expect(waiting.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
  });

  test("Web Locks非対応ではDraft競合を避けるため読み取り専用にする", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    });
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
    await expect(page.locator('[data-status="unsupported"]')).toBeVisible();
  });

  test("編集権取得前の一時的な読込失敗から自動復旧する", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    await page.evaluate(() => {
      (window as any).__mockLocalLoadShouldFailOnce = true;
    });
    await selectMemo(page, "開発メモ");

    await expect
      .poll(() => page.evaluate(() => (window as any).__mockLocalLoadShouldFailOnce))
      .toBe(false);
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
    await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  });

  test("編集タブ終了後に待機タブが永続化済みDraftの送信を引き継ぐ", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    const marker = `lease-sync-handoff-${Date.now()}`;

    await owner.evaluate(() => {
      (window as any).__mockContentShouldFail = true;
    });
    await typeInEditor(owner, marker);
    await expect(owner.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => (await idbGetDocumentContent(owner, MEMO_STORE, MEMO_ID)).draft?.kind)
      .toBe("pending");

    await owner.close();
    await expect(waiting.locator('[data-status="locked"]')).not.toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => {
        const content = await idbGetDocumentContent(waiting, MEMO_STORE, MEMO_ID);
        return { content: content.body.content, draft: content.draft };
      })
      .toEqual({ content: expect.stringContaining(marker), draft: null });
  });

  test("ローカル保存失敗を再試行してから編集権を引き継ぐ", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    const marker = `lease-handoff-${Date.now()}`;

    await owner.evaluate(() => {
      (window as any).__mockLocalSaveShouldFailOnce = true;
    });
    await typeInEditor(owner, marker);
    await selectMemo(owner, "議事録");

    await expect(waiting.locator('[data-status="locked"]')).not.toBeVisible({ timeout: 5_000 });
    await expect(waiting.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
    await expect(waiting.locator(".ProseMirror")).toContainText(marker);
  });

  test("新しい保存の成功後に遅れて失敗した古い本文を再送しない", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const firstMarker = `out-of-order-first-${Date.now()}`;
    const latestMarker = `out-of-order-latest-${Date.now()}`;

    await page.evaluate(() => {
      (window as any).__mockLocalSaveShouldFailOnce = true;
      (window as any).__mockLocalSaveFailureDelayMs = 700;
    });
    await typeInEditor(page, firstMarker);
    await expect
      .poll(() => page.evaluate(() => (window as any).__mockLocalSaveShouldFailOnce))
      .toBe(false);

    await typeInEditor(page, latestMarker);
    await selectMemo(page, "議事録");
    await page.waitForTimeout(800);
    await selectMemo(page, "設計ドキュメント");

    await expect
      .poll(async () => {
        const state = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
        return { content: state.body.content, draft: state.draft };
      })
      .toEqual({ content: expect.stringContaining(latestMarker), draft: null });
  });

  test("別文書にいた待機タブも取得済みActive Draftの送信を引き継ぐ", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    await selectMemo(waiting, "議事録");
    const marker = `immediate-lease-handoff-${Date.now()}`;

    await owner.evaluate(() => {
      (window as any).__mockContentShouldFail = true;
    });
    await typeInEditor(owner, marker);
    await expect(owner.locator('[data-status="error"]')).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => (await idbGetDocumentContent(owner, MEMO_STORE, MEMO_ID)).draft?.kind)
      .toBe("pending");
    await owner.close();

    await selectMemo(waiting, "開発メモ");
    await expect(waiting.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
    await expect
      .poll(async () => {
        const state = await idbGetDocumentContent(waiting, MEMO_STORE, MEMO_ID);
        return { content: state.body.content, draft: state.draft };
      })
      .toEqual({ content: expect.stringContaining(marker), draft: null });
  });

  test("Active DraftをIDB正本として読み取り専用タブへ反映する", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context, "1500");
    await waitForSyncComplete(owner);
    const marker = `active-draft-${Date.now()}`;

    await typeInEditor(owner, marker);
    await expect(waiting.locator(".ProseMirror")).toContainText(marker, { timeout: 5_000 });

    const persisted = await idbGetDocumentContent(waiting, MEMO_STORE, MEMO_ID);
    expect(persisted.draft).toMatchObject({ kind: "pending" });
    expect(persisted.content).toContain(marker);
  });

  test("確定した本文を読み取り専用タブへ反映する", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    const marker = `committed-${Date.now()}`;

    await typeInEditor(owner, marker);
    await expect
      .poll(async () => (await idbGetDocumentContent(waiting, MEMO_STORE, MEMO_ID)).draft)
      .toBeNull();
    await expect(waiting.locator(".ProseMirror")).toContainText(marker);
    await expect(waiting.locator('[data-status="conflict"]')).toHaveCount(0);
  });

  test("別文書を表示中の更新を再選択時にIDBから反映する", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    await selectMemo(waiting, "議事録");
    const marker = `background-${Date.now()}`;

    await typeInEditor(owner, marker);
    await selectMemo(waiting, "開発メモ");
    await expect(waiting.locator(".ProseMirror")).toContainText(marker, { timeout: 5_000 });
  });

  test("通知を取り逃しても再選択時にCommitted Bodyを再読込する", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await selectMemo(page, "議事録");

    const marker = `missed-invalidation-${Date.now()}`;
    const body = await idbGet(page, "documentBodies", MEMO_KEY);
    await idbPut(page, "documentBodies", {
      ...body,
      content: `# IndexedDB update\n\n${marker}`,
      revision: body.revision + 1,
      updatedAt: new Date().toISOString(),
    });

    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText(marker, { timeout: 5_000 });
  });

  test("入力待ち中に進んだリモートrevisionを暗黙に上書きしない", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    const localMarker = `debounced-local-${Date.now()}`;
    const remoteMarker = `debounced-remote-${Date.now()}`;

    await typeInEditor(page, localMarker);
    await idbPut(page, "documentBodies", {
      key: MEMO_KEY,
      content: remoteMarker,
      revision: before.body.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    await page.evaluate(
      ({ storeName, id }) => {
        const channel = new BroadcastChannel("gas-pomodoro-document-content-v2");
        channel.postMessage({
          type: "document-invalidated",
          sourceInstanceId: "playwright",
          storeName,
          id,
        });
        channel.close();
      },
      { storeName: MEMO_STORE, id: MEMO_ID },
    );

    await expect(page.locator('[data-status="conflict"]')).toBeVisible({ timeout: 5_000 });
    const state = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    expect(state.draft).toMatchObject({
      kind: "conflict",
      localContent: expect.stringContaining(localMarker),
      remote: {
        content: remoteMarker,
        revision: before.body.revision + 1,
      },
    });
  });

  test("永続化した競合を再読込し、リモート本文を明示的に選べる", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    const localMarker = `conflict-local-${Date.now()}`;
    const remoteMarker = `conflict-remote-${Date.now()}`;
    await idbPut(page, "activeDocumentDrafts", {
      kind: "pending",
      key: MEMO_KEY,
      content: localMarker,
      baseRevision: before.body.revision,
      mutationId: crypto.randomUUID(),
      localVersion: Date.now(),
      updatedAt: new Date().toISOString(),
    });
    await setMockContentOverride(page, {
      content: remoteMarker,
      contentRevision: before.body.revision + 1,
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    const conflict = page.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".ProseMirror")).toContainText(localMarker);

    const additionalLocal = `conflict-additional-${Date.now()}`;
    await typeInEditor(page, additionalLocal);
    await page.waitForTimeout(2_500);
    await expect(conflict).toBeVisible();
    expect(await idbGet(page, "activeDocumentDrafts", MEMO_KEY)).toMatchObject({
      kind: "conflict",
      localContent: expect.stringContaining(additionalLocal),
    });

    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(page.locator(".ProseMirror")).toContainText(remoteMarker);
    await expect(conflict).toHaveCount(0);
    expect(await idbGet(page, "activeDocumentDrafts", MEMO_KEY)).toBeNull();
  });

  test("永続化した競合でローカル本文を明示的に保存できる", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    const localMarker = `keep-local-${Date.now()}`;
    await idbPut(page, "activeDocumentDrafts", {
      kind: "pending",
      key: MEMO_KEY,
      content: localMarker,
      baseRevision: before.body.revision,
      mutationId: crypto.randomUUID(),
      localVersion: Date.now(),
      updatedAt: new Date().toISOString(),
    });
    await setMockContentOverride(page, {
      content: `keep-local-remote-${Date.now()}`,
      contentRevision: before.body.revision + 1,
      updatedAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    const conflict = page.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 5_000 });
    await conflict.getByRole("button", { name: "この内容を保存" }).click();

    await expect
      .poll(async () => {
        const state = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
        return { content: state.body.content, draft: state.draft };
      })
      .toEqual({ content: localMarker, draft: null });
    await expect(conflict).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText(localMarker);
  });

  test("表示後に更新された競合を古い操作で解消しない", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const before = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    const localMarker = `stale-conflict-local-${Date.now()}`;
    const oldRemote = `stale-conflict-remote-old-${Date.now()}`;
    const latestRemote = `stale-conflict-remote-latest-${Date.now()}`;
    const now = new Date().toISOString();

    await idbPut(page, "activeDocumentDrafts", {
      kind: "pending",
      key: MEMO_KEY,
      content: localMarker,
      baseRevision: before.body.revision,
      mutationId: crypto.randomUUID(),
      localVersion: Date.now(),
      updatedAt: now,
    });
    await setMockContentOverride(page, {
      content: oldRemote,
      contentRevision: before.body.revision + 1,
      updatedAt: now,
    });
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    const conflict = page.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 5_000 });

    const current = await idbGetDocumentContent(page, MEMO_STORE, MEMO_ID);
    const latestRevision = current.body.revision + 1;
    await idbPut(page, "documentBodies", {
      ...current.body,
      content: latestRemote,
      revision: latestRevision,
      updatedAt: new Date().toISOString(),
    });
    await idbPut(page, "activeDocumentDrafts", {
      kind: "conflict",
      key: MEMO_KEY,
      localContent: localMarker,
      localVersion: (current.draft?.localVersion || Date.now()) + 1,
      updatedAt: new Date().toISOString(),
      remote: {
        key: MEMO_KEY,
        content: latestRemote,
        revision: latestRevision,
        updatedAt: new Date().toISOString(),
      },
    });

    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(page.locator(".ProseMirror")).toContainText(latestRemote);
    await expect(conflict).toHaveCount(0);
    expect(await idbGet(page, "activeDocumentDrafts", MEMO_KEY)).toBeNull();
  });

  test("サーバー一覧から消えた文書のDraftをRecoveryへ移す", async ({ page }) => {
    await gotoApp(page);
    const id = `server-missing-${Date.now()}`;
    const key = `${MEMO_STORE}:${id}`;
    const content = `recovery-${Date.now()}`;
    const now = new Date().toISOString();
    await idbPut(page, MEMO_STORE, {
      id,
      name: "server missing memo",
      isActive: true,
      updatedAt: now,
      _serverUpdatedAt: now,
    });
    await idbPut(page, "documentBodies", {
      key,
      content: "",
      revision: 1,
      updatedAt: now,
    });
    await idbPut(page, "activeDocumentDrafts", {
      kind: "pending",
      key,
      content,
      baseRevision: 1,
      mutationId: crypto.randomUUID(),
      localVersion: Date.now(),
      updatedAt: now,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await expect
      .poll(async () =>
        (await idbGetAll(page, "recoveryDocumentDrafts")).find(
          (draft) => draft.documentKey === key,
        ),
      )
      .toMatchObject({ content, reason: "inactive" });
    expect(await idbGet(page, "activeDocumentDrafts", key)).toBeNull();
    await expect(page.getByLabel("回復用の本文")).toContainText(content);
  });

  test("別タブで作られたRecoveryを再読込なしで表示する", async ({ context }) => {
    const { owner, waiting } = await openSameMemo(context);
    await waitForSyncComplete(owner);
    const before = await idbGetDocumentContent(owner, MEMO_STORE, MEMO_ID);
    await owner.evaluate(
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
    const marker = `cross-tab-recovery-${Date.now()}`;

    await typeInEditor(owner, marker);
    await selectMemo(owner, "議事録");

    await expect(waiting.getByLabel("回復用の本文")).toContainText(marker, {
      timeout: 5_000,
    });
  });

  test("entity行を失ったDraftもnotFoundのRecoveryへ移す", async ({ page }) => {
    await gotoApp(page);
    const id = `missing-entity-${Date.now()}`;
    const key = `${MEMO_STORE}:${id}`;
    const content = `missing-entity-recovery-${Date.now()}`;
    const now = new Date().toISOString();
    await idbPut(page, "documentBodies", {
      key,
      content: "",
      revision: 1,
      updatedAt: now,
    });
    await idbPut(page, "activeDocumentDrafts", {
      kind: "pending",
      key,
      content,
      baseRevision: 1,
      mutationId: crypto.randomUUID(),
      localVersion: Date.now(),
      updatedAt: now,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await expect
      .poll(async () =>
        (await idbGetAll(page, "recoveryDocumentDrafts")).find(
          (draft) => draft.documentKey === key,
        ),
      )
      .toMatchObject({ content, reason: "notFound" });
    expect(await idbGet(page, "activeDocumentDrafts", key)).toBeNull();
  });

  test("旧形式の複数Draftを一度だけ移行し、選外本文をRecoveryへ残す", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const entity = await idbGet(page, MEMO_STORE, MEMO_ID);
    const body = await idbGet(page, "documentBodies", MEMO_KEY);
    const newest = `legacy-newest-${Date.now()}`;
    const older = `legacy-older-${Date.now()}`;
    const newestAt = new Date().toISOString();
    const olderAt = new Date(Date.now() - 60_000).toISOString();

    await idbDelete(page, "documentBodies", MEMO_KEY);
    await idbDelete(page, "activeDocumentDrafts", MEMO_KEY);
    await idbPut(page, MEMO_STORE, {
      ...entity,
      content: body.content,
      _serverContent: body.content,
      contentRevision: body.revision,
    });
    await idbPut(page, "documentDrafts", {
      key: `old-a:${MEMO_KEY}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      content: older,
      baseRevision: body.revision,
      mutationId: "old-a",
      dirtyAt: olderAt,
    });
    await idbPut(page, "documentDrafts", {
      key: `old-b:${MEMO_KEY}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      content: newest,
      baseRevision: body.revision,
      mutationId: "old-b",
      dirtyAt: newestAt,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText(newest);
    const recoveries = await idbGetAll(page, "recoveryDocumentDrafts");
    expect(recoveries.find((draft) => draft.content === older)).toMatchObject({
      documentKey: MEMO_KEY,
      reason: "superseded",
    });
    expect(
      (await idbGetAll(page, "documentDrafts")).filter(
        (draft) => draft.storeName === MEMO_STORE && draft.id === MEMO_ID,
      ),
    ).toHaveLength(0);
  });

  test("entity行のない旧形式DraftもRecoveryへ移行する", async ({ page }) => {
    await gotoApp(page);
    const id = `orphan-legacy-${Date.now()}`;
    const key = `${MEMO_STORE}:${id}`;
    const content = `orphan-legacy-content-${Date.now()}`;
    await idbPut(page, "documentDrafts", {
      key: `old-tab:${key}`,
      storeName: MEMO_STORE,
      id,
      content,
      baseRevision: 1,
      mutationId: "orphan-legacy-mutation",
      dirtyAt: new Date().toISOString(),
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await expect
      .poll(async () =>
        (await idbGetAll(page, "recoveryDocumentDrafts")).find(
          (draft) => draft.documentKey === key,
        ),
      )
      .toMatchObject({ content, reason: "notFound" });
    expect(
      (await idbGetAll(page, "documentDrafts")).filter(
        (draft) => draft.storeName === MEMO_STORE && draft.id === id,
      ),
    ).toHaveLength(0);
    await expect(page.getByLabel("回復用の本文")).toContainText(content);
  });

  test("メタデータのマージでCommitted Bodyを変更しない", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const before = await idbGet(page, "documentBodies", MEMO_KEY);

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    expect(await idbGet(page, "documentBodies", MEMO_KEY)).toEqual(before);
  });

  test("新規プロジェクト作成後に本文をrevision 1から保存する", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "タスク", exact: true }).click();
    const content = `new-project-content-${Date.now()}`;
    const projectName = `new mock project ${Date.now()}`;
    page.once("dialog", (dialog) => void dialog.accept(projectName));
    await page.locator("[class*='sidebar-header']:visible button", { hasText: "+" }).click();
    const project = page.locator('[data-type="project"]', { hasText: projectName });
    await expect(project).toBeVisible();
    await project.locator("[class*='task-tree-item']").click();
    const editor = page.locator(".ProseMirror:visible");
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 10_000 });
    await editor.click();
    await page.keyboard.insertText(content);

    await expect
      .poll(async () =>
        page.evaluate((expectedContent) => {
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith("gas_pomodoro_mock_server_content_")) continue;
            const state = JSON.parse(localStorage.getItem(key) || "null");
            if (state?.content === expectedContent) return state.contentRevision;
          }
          return null;
        }, content),
      )
      .toBe(2);
    await expect(page.getByLabel("回復用の本文")).toHaveCount(0);
  });

  test("新規メモ作成後に本文をrevision 1から保存する", async ({ page }) => {
    await gotoApp(page);
    const content = `new-memo-content-${Date.now()}`;
    await page.locator("[class*='sidebar-header']:visible button", { hasText: "+" }).click();
    const memo = page.locator("[class*='sidebar-item']", { hasText: "新しいメモ" }).last();
    await expect(memo).toBeVisible();
    await memo.click();
    const editor = page.locator(".ProseMirror:visible");
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 10_000 });
    await editor.click();
    await page.keyboard.insertText(content);

    await expect
      .poll(async () =>
        page.evaluate((expectedContent) => {
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith("gas_pomodoro_mock_server_content_")) continue;
            const state = JSON.parse(localStorage.getItem(key) || "null");
            if (state?.content === expectedContent) return state.contentRevision;
          }
          return null;
        }, content),
      )
      .toBe(2);
    await expect(page.getByLabel("回復用の本文")).toHaveCount(0);
  });
});
