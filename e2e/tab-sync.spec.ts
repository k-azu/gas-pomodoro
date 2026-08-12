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

async function dragSidebarItemAfter(page: Page, draggingId: string, targetId: string) {
  const dragging = page.locator(`[class*='sidebar-item'][data-id="${draggingId}"]`);
  const target = page.locator(`[class*='sidebar-item'][data-id="${targetId}"]`);
  const [draggingBox, targetBox] = await Promise.all([
    dragging.boundingBox(),
    target.boundingBox(),
  ]);
  if (!draggingBox || !targetBox) throw new Error("Cannot resolve sidebar item positions");

  await page.mouse.move(
    draggingBox.x + draggingBox.width / 2,
    draggingBox.y + draggingBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height, {
    steps: 5,
  });
  await page.mouse.up();
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

  test("待機タブでは選択中メモの名称・タグ・コンテキスト操作も読み取り専用にする", async ({
    context,
  }) => {
    const { owner, waiting } = await openSameMemo(context);
    const ownerName = owner.locator("[class*='meta-title-row'] input");
    const waitingName = waiting.locator("[class*='meta-title-row'] input");

    await ownerName.click();
    await expect(ownerName).not.toHaveAttribute("readonly", "");
    await waitingName.click();
    await expect(waitingName).toHaveAttribute("readonly", "");
    await expect(waiting.locator("[class*='readonly-tags']")).toBeVisible();
    await expect(waiting.getByText("アーカイブ済み・読み取り専用", { exact: true })).toHaveCount(0);

    const activeSidebarItem = waiting.locator("[class*='sidebar-item'][class*='active']");
    await activeSidebarItem.click({ button: "right" });
    await expect(waiting.getByText("名前変更", { exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(waiting.getByText("削除", { exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("待機タブでは選択中プロジェクトの名称・色・サイドバー操作も読み取り専用にする", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await Promise.all([gotoApp(pageA), gotoApp(pageB)]);
    await Promise.all([
      pageA.getByRole("button", { name: "タスク", exact: true }).click(),
      pageB.getByRole("button", { name: "タスク", exact: true }).click(),
    ]);
    const selectProject = async (page: Page) => {
      const project = page.locator('[data-type="project"][data-id="mock-proj-1"]');
      await project.locator(":scope > [class*='task-tree-item']").click();
      await page.waitForSelector(".ProseMirror:visible", { timeout: 5_000 });
    };
    await Promise.all([selectProject(pageA), selectProject(pageB)]);
    await expect
      .poll(async () => {
        const [aLocked, bLocked] = await Promise.all([
          pageA.locator('[data-status="locked"]:visible').isVisible(),
          pageB.locator('[data-status="locked"]:visible').isVisible(),
        ]);
        return Number(aLocked) + Number(bLocked);
      })
      .toBe(1);
    const waiting = (await pageA.locator('[data-status="locked"]:visible').isVisible())
      ? pageA
      : pageB;

    const name = waiting.locator("[class*='meta-title-row'] input:visible");
    await name.click();
    await expect(name).toHaveAttribute("readonly", "");
    await expect(waiting.locator('input[type="color"]:visible')).toBeDisabled();

    const activeProject = waiting.locator(
      '[data-type="project"][data-id="mock-proj-1"] > [class*="task-tree-item"]',
    );
    await activeProject.click({ button: "right" });
    await expect(waiting.getByText("名前変更", { exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(waiting.getByText("アーカイブ", { exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(waiting.getByText("案件を追加", { exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("同一メタデータの送信とACKをタブ間で直列化し、新しい更新をdirtyのまま失わない", async ({
    context,
  }) => {
    const { owner, waiting } = await openSameMemo(context);
    const metadataMemoId = "mock-memo-2";
    const logKey = "gas_pomodoro_mock_server_metadata_log";
    const firstName = `metadata-first-${Date.now()}`;
    const latestName = `metadata-latest-${Date.now()}`;
    const renameFromSidebar = async (page: Page, currentName: string, nextName: string) => {
      await page.locator("[class*='sidebar-item']", { hasText: currentName }).click({
        button: "right",
      });
      await page.getByText("名前変更", { exact: true }).click();
      const input = page.locator("input[class*='sidebar-rename-input']");
      await input.fill(nextName);
      await input.press("Enter");
    };

    await owner.evaluate((key) => {
      localStorage.removeItem(key);
      window.__mockMetadataDelayMs = 1_200;
    }, logKey);
    await waiting.evaluate(() => {
      window.__mockMetadataDelayMs = 0;
    });

    await renameFromSidebar(owner, "議事録", firstName);
    await expect
      .poll(() =>
        owner.evaluate(
          ({ key, name }) => {
            const events = JSON.parse(localStorage.getItem(key) || "[]");
            return events.some(
              (event: any) => event.phase === "start" && event.fields?.name === name,
            );
          },
          { key: logKey, name: firstName },
        ),
      )
      .toBe(true);

    await expect(waiting.locator("[class*='sidebar-item']", { hasText: firstName })).toBeVisible();
    await renameFromSidebar(waiting, firstName, latestName);

    await expect
      .poll(
        async () => {
          const entity = await idbGet(waiting, MEMO_STORE, metadataMemoId);
          return { name: entity?.name, dirty: entity?._dirty };
        },
        { timeout: 8_000 },
      )
      .toEqual({ name: latestName, dirty: false });

    const completedNames = await waiting.evaluate((key) => {
      const events = JSON.parse(localStorage.getItem(key) || "[]");
      return events
        .filter((event: any) => event.phase === "complete")
        .map((event: any) => event.fields?.name)
        .filter(Boolean);
    }, logKey);
    expect(completedNames).toEqual([firstName, latestName]);
  });

  test("並び替えはタブ間で最新のコレクション状態だけを同期する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await Promise.all([gotoApp(pageA), gotoApp(pageB)]);

    await dragSidebarItemAfter(pageA, "mock-memo-1", "mock-memo-2");
    await expect
      .poll(async () => {
        const intent = await idbGet(pageA, "collectionSyncIntents", "memos:root");
        return intent?.args?.[0]?.slice(0, 2);
      })
      .toEqual(["mock-memo-2", "mock-memo-1"]);
    await expect
      .poll(() =>
        pageB
          .locator("[class*='sidebar-item'][data-id]")
          .evaluateAll((items) =>
            items.slice(0, 2).map((item) => (item as HTMLElement).dataset.id),
          ),
      )
      .toEqual(["mock-memo-2", "mock-memo-1"]);

    await dragSidebarItemAfter(pageB, "mock-memo-2", "mock-memo-1");
    await expect
      .poll(async () => {
        const intent = await idbGet(pageB, "collectionSyncIntents", "memos:root");
        return intent?.args?.[0]?.slice(0, 2);
      })
      .toEqual(["mock-memo-1", "mock-memo-2"]);

    await expect
      .poll(
        () =>
          pageB.evaluate(() => {
            const state = JSON.parse(
              localStorage.getItem("gas_pomodoro_mock_server_metadata") || "{}",
            );
            return [
              state.memos?.["mock-memo-1"]?.sortOrder,
              state.memos?.["mock-memo-2"]?.sortOrder,
            ];
          }),
        { timeout: 10_000 },
      )
      .toEqual([1, 2]);
    await expect.poll(() => idbGet(pageB, "collectionSyncIntents", "memos:root")).toBeNull();
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

    await expect
      .poll(async () => {
        const projects = await idbGetAll(page, "projects");
        return projects.find((item) => item.name === projectName && item._pendingCreate === false);
      })
      .not.toBeUndefined();
    await page.reload();
    await page.getByRole("button", { name: "タスク", exact: true }).click();
    await expect(page.locator('[data-type="project"]', { hasText: projectName })).toBeVisible();
    const reloadedProjects = await idbGetAll(page, "projects");
    expect(reloadedProjects.find((item) => item.name === projectName)).toMatchObject({
      isActive: true,
      _pendingCreate: false,
    });
  });

  test("新規作成の応答喪失後も同じIDで冪等に再試行する", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: "タスク", exact: true }).click();
    await page.evaluate(() => {
      window.__mockCreateShouldLoseResponseOnce = true;
    });
    const projectName = `idempotent create ${Date.now()}`;
    page.once("dialog", (dialog) => void dialog.accept(projectName));
    await page.locator("[class*='sidebar-header']:visible button", { hasText: "+" }).click();

    await expect
      .poll(async () => {
        const projects = await idbGetAll(page, "projects");
        return projects.find((item) => item.name === projectName) ?? null;
      })
      .not.toBeNull();

    await expect
      .poll(
        async () => {
          const projects = await idbGetAll(page, "projects");
          return projects.find(
            (item) => item.name === projectName && item._pendingCreate === false,
          );
        },
        { timeout: 10_000 },
      )
      .not.toBeUndefined();

    const projects = await idbGetAll(page, "projects");
    const projectId = String(projects.find((item) => item.name === projectName)?.id || "");
    expect(projectId).not.toBe("");
    await expect
      .poll(() => page.evaluate((id) => window.__mockCreateCallCounts?.[id] ?? 0, projectId))
      .toBe(2);
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

    await expect
      .poll(async () => {
        const memos = await idbGetAll(page, "memos");
        return memos.find((item) => item.name === "新しいメモ" && item._pendingCreate === false);
      })
      .not.toBeUndefined();
    await page.reload();
    await expect(
      page.locator("[class*='sidebar-item']", { hasText: "新しいメモ" }).last(),
    ).toBeVisible();
    const reloadedMemos = await idbGetAll(page, "memos");
    expect(reloadedMemos.find((item) => item.name === "新しいメモ")).toMatchObject({
      isActive: true,
      _pendingCreate: false,
    });
  });
});
