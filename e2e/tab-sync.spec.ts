import { test, expect } from "@playwright/test";
import {
  gotoApp,
  selectMemo,
  switchToMarkdownMode,
  typeInEditor,
  waitForSyncComplete,
} from "./helpers/app";
import { idbGet, idbGetAll, idbPut } from "./helpers/idb";

const MEMO_STORE = "memos";
const MEMO_ID = "mock-memo-1";

test.describe("複数タブの本文同期", () => {
  test("保存が確定した本文を未編集の別タブへ反映する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await Promise.all([gotoApp(pageA), gotoApp(pageB)]);
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const marker = `tab-a-${Date.now()}`;
    await typeInEditor(pageA, marker);

    await expect(pageB.locator(".ProseMirror")).toContainText(marker, { timeout: 10_000 });
    await expect(pageB.locator('[data-status="conflict"]')).toHaveCount(0);
  });

  test("別文書を表示中に届いた更新を再選択時に反映する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await Promise.all([gotoApp(pageA), gotoApp(pageB)]);
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);
    await selectMemo(pageB, "議事録");
    await waitForSyncComplete(pageB);

    const marker = `background-tab-${Date.now()}`;
    await typeInEditor(pageA, marker);
    await pageA.waitForTimeout(2500);

    await selectMemo(pageB, "開発メモ");
    await expect(pageB.locator(".ProseMirror")).toContainText(marker, { timeout: 10_000 });
  });

  test("複製されたsessionStorageのtabIdを再採番する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const duplicatedTabId = `duplicated-${Date.now()}`;
    await Promise.all(
      [pageA, pageB].map((page) =>
        page.addInitScript(
          (id) => sessionStorage.setItem("gas_pomodoro_tab_id", id),
          duplicatedTabId,
        ),
      ),
    );

    await gotoApp(pageA);
    await gotoApp(pageB);
    await expect
      .poll(async () => {
        const [tabA, tabB] = await Promise.all([
          pageA.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id")),
          pageB.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id")),
        ]);
        return tabA !== tabB;
      })
      .toBe(true);

    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);
    const marker = `duplicated-tab-${Date.now()}`;
    await typeInEditor(pageA, marker);
    await expect(pageB.locator(".ProseMirror")).toContainText(marker, { timeout: 10_000 });
  });

  test("tabIdの再採番時に古いタブの下書きと所有者を移動しない", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const duplicatedTabId = `duplicated-draft-${Date.now()}`;
    await Promise.all(
      [pageA, pageB].map((page) =>
        page.addInitScript((id) => {
          sessionStorage.setItem("gas_pomodoro_tab_id", id);
          Object.defineProperty(navigator, "locks", { value: undefined });
        }, duplicatedTabId),
      ),
    );

    await gotoApp(pageA);
    await selectMemo(pageA, "開発メモ");
    await waitForSyncComplete(pageA);
    const marker = "draft owned by older tab";
    const record = await idbGet(pageA, MEMO_STORE, MEMO_ID);
    const dirtyAt = new Date().toISOString();
    const baseRevision = Math.max(1, Number(record.contentRevision) || 1);
    await idbPut(pageA, MEMO_STORE, {
      ...record,
      content: marker,
      _contentDirtyAt: dirtyAt,
      _contentDirtyOwner: duplicatedTabId,
      _draftBaseRevision: baseRevision,
    });
    await idbPut(pageA, "documentDrafts", {
      key: `${duplicatedTabId}:${MEMO_STORE}:${MEMO_ID}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      tabId: duplicatedTabId,
      content: marker,
      baseRevision,
      mutationId: `${duplicatedTabId}-mutation`,
      dirtyAt,
    });

    await gotoApp(pageB);
    await expect
      .poll(() => pageB.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id")))
      .not.toBe(duplicatedTabId);
    await selectMemo(pageB, "開発メモ");
    const rotatedTabId = await pageB.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));

    await expect
      .poll(async () => {
        const drafts = await idbGetAll(pageB, "documentDrafts");
        const original = drafts.find(
          (draft) => draft.storeName === MEMO_STORE && draft.id === MEMO_ID,
        );
        const storedRecord = await idbGet(pageB, MEMO_STORE, MEMO_ID);
        return {
          draftTabId: original?.tabId,
          hasRotatedDraft: drafts.some((draft) => draft.tabId === rotatedTabId),
          owner: storedRecord?._contentDirtyOwner,
        };
      })
      .toEqual({
        draftTabId: duplicatedTabId,
        hasRotatedDraft: false,
        owner: duplicatedTabId,
      });

    await pageA.reload();
    await pageA.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(pageA, "開発メモ");
    await expect(pageA.locator(".ProseMirror")).toContainText(marker);
  });

  test("heartbeatが失効してもWeb Lockを保持する稼働中タブの下書きを奪わない", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await Promise.all([gotoApp(pageA), gotoApp(pageB)]);
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const tabAId = await pageA.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));
    expect(tabAId).toBeTruthy();
    await expect
      .poll(() =>
        pageA.evaluate(async (id) => {
          const locks = await navigator.locks.query();
          return locks.held?.some((lock) => lock.name === `gas-pomodoro:tab:${id}`) ?? false;
        }, tabAId),
      )
      .toBe(true);

    const marker = `active-tab-draft-${Date.now()}`;
    const dirtyAt = new Date().toISOString();
    const record = await idbGet(pageA, MEMO_STORE, MEMO_ID);
    const baseRevision = Math.max(1, Number(record.contentRevision) || 1);
    await idbPut(pageA, MEMO_STORE, {
      ...record,
      content: marker,
      _contentDirtyAt: dirtyAt,
      _contentDirtyOwner: tabAId,
      _draftBaseRevision: baseRevision,
    });
    await idbPut(pageA, "documentDrafts", {
      key: `${tabAId}:${MEMO_STORE}:${MEMO_ID}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      tabId: tabAId,
      content: marker,
      baseRevision,
      mutationId: `${tabAId}-mutation`,
      dirtyAt,
    });
    // Model a background/frozen tab whose JavaScript heartbeat stopped. Patch
    // only page A's Storage realm so its interval cannot refresh the key while
    // page B reloads and checks ownership.
    await pageA.evaluate((id) => {
      const heartbeatKey = `gas_pomodoro_tab_heartbeat_${id}`;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === heartbeatKey) return;
        originalSetItem.call(this, key, value);
      };
      localStorage.removeItem(heartbeatKey);
    }, tabAId);

    await pageB.reload();
    await pageB.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(pageB, "開発メモ");
    await expect(pageB.locator(".ProseMirror")).not.toContainText(marker);

    const drafts = await idbGetAll(pageB, "documentDrafts");
    expect(drafts.some((draft) => draft.tabId === tabAId && draft.content === marker)).toBe(true);
  });

  test("別タブの編集中本文を上書きせず競合として表示する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    // Delay B's content RPC so A deterministically commits first.
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const localMarker = `tab-b-local-${Date.now()}`;
    const remoteMarker = `tab-a-remote-${Date.now()}`;
    await typeInEditor(pageB, localMarker);
    await pageB.waitForTimeout(300);
    await typeInEditor(pageA, remoteMarker);

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });

    // The local draft remains visible until the user explicitly resolves it.
    await expect(pageB.locator(".ProseMirror")).toContainText(localMarker);
    await expect(pageB.locator(".ProseMirror")).not.toContainText(remoteMarker);

    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(pageB.locator(".ProseMirror")).toContainText(remoteMarker, { timeout: 5_000 });
    await expect(pageB.locator(".ProseMirror")).not.toContainText(localMarker);
    await expect(conflict).toHaveCount(0);
  });

  test("競合時にローカル本文を明示的に再保存できる", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const localMarker = `keep-local-${Date.now()}`;
    const remoteMarker = `remote-first-${Date.now()}`;
    await typeInEditor(pageB, localMarker);
    await pageB.waitForTimeout(300);
    await typeInEditor(pageA, remoteMarker);

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    await conflict.getByRole("button", { name: "この内容を保存" }).click();

    // B retries against the latest revision; the committed result is broadcast to A.
    await expect(pageA.locator(".ProseMirror")).toContainText(localMarker, { timeout: 10_000 });
    await expect(pageA.locator(".ProseMirror")).not.toContainText(remoteMarker);
  });

  test("競合中の追加入力を保持し、解決保存の失敗後も再試行できる", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const localMarker = `conflict-edit-${Date.now()}`;
    const addedMarker = `conflict-added-${Date.now()}`;
    const remoteMarker = `conflict-remote-${Date.now()}`;
    await typeInEditor(pageB, localMarker);
    await pageB.waitForTimeout(300);
    await typeInEditor(pageA, remoteMarker);

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    const editor = pageB.locator(".ProseMirror");
    await editor.focus();
    await editor.press("Control+End");
    await pageB.keyboard.insertText(addedMarker);
    await expect(conflict).toBeVisible();

    await pageB.evaluate(() => {
      (window as any).__mockLocalSaveShouldFailOnce = true;
    });
    await conflict.getByRole("button", { name: "この内容を保存" }).click();

    // The remote snapshot remains available after the failed resolution save.
    await expect(conflict).toBeVisible({ timeout: 5_000 });
    await expect(editor).toContainText(localMarker);
    await expect(editor).toContainText(addedMarker);

    await conflict.getByRole("button", { name: "この内容を保存" }).click();
    await expect(pageA.locator(".ProseMirror")).toContainText(localMarker, { timeout: 10_000 });
    await expect(pageA.locator(".ProseMirror")).toContainText(addedMarker);
    await expect(pageA.locator(".ProseMirror")).not.toContainText(remoteMarker);
  });

  test("競合解決保存中の追加入力を保持し、別の解決操作を開始させない", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const localMarker = `resolution-local-${Date.now()}`;
    const addedMarker = `resolution-added-${Date.now()}`;
    const remoteMarker = `resolution-remote-${Date.now()}`;
    await typeInEditor(pageB, localMarker);
    await pageB.waitForTimeout(300);
    await typeInEditor(pageA, remoteMarker);

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    await conflict.getByRole("button", { name: "この内容を保存" }).click();

    const syncing = pageB.locator('[data-status="syncing"]');
    await expect(syncing).toBeVisible();
    const editor = pageB.locator(".ProseMirror");
    await editor.focus();
    await editor.press("Control+End");
    await pageB.keyboard.insertText(addedMarker);

    await expect(syncing).toBeVisible();
    await expect(pageB.locator('[data-status="conflict"]')).toHaveCount(0);
    await expect(pageA.locator(".ProseMirror")).toContainText(addedMarker, { timeout: 12_000 });
    await expect(pageA.locator(".ProseMirror")).not.toContainText(remoteMarker);
  });

  test("別文書の表示中に届いた競合を再選択時に復元する", async ({ context }) => {
    const pageB = await context.newPage();
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await selectMemo(pageB, "開発メモ");
    await waitForSyncComplete(pageB);

    const localMarker = `background-conflict-local-${Date.now()}`;
    const remoteMarker = `background-conflict-remote-${Date.now()}`;
    await typeInEditor(pageB, localMarker);

    const record = await idbGet(pageB, MEMO_STORE, MEMO_ID);
    const remoteRevision = Math.max(1, Number(record.contentRevision) || 1) + 1;
    await pageB.evaluate(
      ({ id, content, revision }) => {
        localStorage.setItem(
          `gas_pomodoro_mock_server_content_${id}`,
          JSON.stringify({
            content,
            updatedAt: new Date().toISOString(),
            contentRevision: revision,
          }),
        );
      },
      {
        id: MEMO_ID,
        content: `# remote update\n\n${remoteMarker}`,
        revision: remoteRevision,
      },
    );

    // Switching flushes the stale local edit. The delayed CAS response arrives
    // after the original editor listener has been unmounted.
    await selectMemo(pageB, "議事録");

    await expect
      .poll(
        async () => {
          const tabId = await pageB.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));
          const drafts = await idbGetAll(pageB, "documentDrafts");
          const persistedConflict = drafts.find(
            (draft) =>
              draft.tabId === tabId && draft.storeName === MEMO_STORE && draft.id === MEMO_ID,
          )?.conflict;
          return persistedConflict
            ? { content: persistedConflict.content, revision: persistedConflict.revision }
            : null;
        },
        { timeout: 10_000 },
      )
      .toEqual({ content: `# remote update\n\n${remoteMarker}`, revision: remoteRevision });

    await selectMemo(pageB, "開発メモ");
    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator(".ProseMirror")).toContainText(localMarker);
    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(pageB.locator(".ProseMirror")).toContainText(remoteMarker, { timeout: 5_000 });
  });

  test("遅れて届いた古い競合内容で新しいリビジョンを巻き戻さない", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    await typeInEditor(pageB, `stale-local-${Date.now()}`);
    await pageB.waitForTimeout(300);
    await typeInEditor(pageA, `revision-two-${Date.now()}`);

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });

    const newestMarker = `newest-${Date.now()}`;
    const newestContent = `# revision three\n\n${newestMarker}`;
    const record = await idbGet(pageA, MEMO_STORE, MEMO_ID);
    await idbPut(pageA, MEMO_STORE, {
      ...record,
      content: newestContent,
      _serverContent: newestContent,
      contentRevision: 3,
      _serverUpdatedAt: new Date().toISOString(),
      _contentDirtyAt: null,
      _contentDirtyOwner: null,
      _draftBaseRevision: null,
    });

    // The button still holds the older revision-two conflict snapshot.
    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await expect(pageB.locator(".ProseMirror")).toContainText(newestMarker);
    const accepted = await idbGet(pageB, MEMO_STORE, MEMO_ID);
    expect(accepted.contentRevision).toBe(3);
    expect(accepted._serverContent).toBe(newestContent);
  });

  test("閉じたタブが残した未同期下書きを現在のタブへ引き継ぐ", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const marker = `orphan-draft-${Date.now()}`;
    const orphanTabId = `closed-tab-${Date.now()}`;
    const dirtyAt = new Date().toISOString();
    const record = await idbGet(page, MEMO_STORE, MEMO_ID);
    const baseRevision = Math.max(1, Number(record.contentRevision) || 1);
    await idbPut(page, MEMO_STORE, {
      ...record,
      content: marker,
      _contentDirtyAt: dirtyAt,
      _contentDirtyOwner: orphanTabId,
      _draftBaseRevision: baseRevision,
    });
    await idbPut(page, "documentDrafts", {
      key: `${orphanTabId}:${MEMO_STORE}:${MEMO_ID}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      tabId: orphanTabId,
      content: marker,
      baseRevision,
      mutationId: `${orphanTabId}-mutation`,
      dirtyAt,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText(marker, { timeout: 5_000 });

    const currentTabId = await page.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));
    const drafts = await idbGetAll(page, "documentDrafts");
    const adopted = drafts.find((draft) => draft.storeName === MEMO_STORE && draft.id === MEMO_ID);
    expect(adopted.tabId).toBe(currentTabId);
    expect(adopted.content).toBe(marker);
    expect(drafts.some((draft) => draft.tabId === orphanTabId)).toBe(false);
  });

  test("保存不能になった本文を回復用パネルからコピー・破棄できる", async ({ page, context }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    const storeName = "projects";
    const id = "mock-proj-1";
    const content = `rejected-draft-${Date.now()}`;
    const source = await idbGet(page, storeName, id);
    const tabId = await page.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));
    const dirtyAt = new Date().toISOString();
    const baseRevision = Math.max(1, Number(source.contentRevision) || 1);
    await page.evaluate(
      ({ id, contentRevision }) => {
        localStorage.setItem(
          `gas_pomodoro_mock_server_content_${id}`,
          JSON.stringify({
            content: "",
            updatedAt: new Date().toISOString(),
            contentRevision,
            isActive: false,
          }),
        );
      },
      { id, contentRevision: baseRevision },
    );
    await idbPut(page, storeName, {
      ...source,
      content,
      _serverContent: "",
      _contentDirtyAt: dirtyAt,
      _contentDirtyOwner: tabId,
      _draftBaseRevision: baseRevision,
    });
    await idbPut(page, "documentDrafts", {
      key: `${tabId}:${storeName}:${id}`,
      storeName,
      id,
      tabId,
      content,
      baseRevision,
      mutationId: `${id}-inactive-mutation`,
      dirtyAt,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));

    await expect
      .poll(async () => {
        const drafts = await idbGetAll(page, "documentDrafts");
        const draft = drafts.find(
          (candidate) => candidate.storeName === storeName && candidate.id === id,
        );
        return draft
          ? {
              content: draft.content,
              recoveryState: draft.recoveryState,
              recoveryReason: draft.recoveryReason,
            }
          : null;
      })
      .toEqual({ content, recoveryState: "rejected", recoveryReason: "inactive" });

    const panel = page.getByLabel("回復用の本文");
    await expect(panel).toBeVisible();
    await panel.locator("summary").click();
    await expect(panel.locator("pre")).toHaveText(content);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByRole("button", { name: "本文をコピー" }).click();
    await expect(panel.getByRole("button", { name: "コピーしました" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(content);

    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: "破棄" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("メタデータ更新で本文とリビジョンの組を崩さない", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    const staleContent = `known-snapshot-${Date.now()}`;
    const target = await idbGet(page, MEMO_STORE, MEMO_ID);
    await idbPut(page, MEMO_STORE, {
      ...target,
      content: staleContent,
      _serverContent: staleContent,
      contentRevision: 2,
      _dirty: false,
    });
    await page.evaluate(
      ({ id }) => {
        localStorage.setItem(
          `gas_pomodoro_mock_server_content_${id}`,
          JSON.stringify({
            content: "newer server body",
            updatedAt: new Date().toISOString(),
            contentRevision: 3,
            isActive: true,
          }),
        );
      },
      { id: MEMO_ID },
    );
    await page.addInitScript(() => {
      (window as any).__mockContentOverride = null;
    });
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    const merged = await idbGet(page, MEMO_STORE, MEMO_ID);

    expect({
      content: merged.content,
      serverContent: merged._serverContent,
      revision: merged.contentRevision,
    }).toEqual({
      content: staleContent,
      serverContent: staleContent,
      revision: 2,
    });
  });

  test("新規プロジェクトの本文をモックサーバーへ保存できる", async ({ page }) => {
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
            if (state?.content === expectedContent) {
              return { content: state.content, contentRevision: state.contentRevision };
            }
          }
          return null;
        }, content),
      )
      .toEqual({ content, contentRevision: 2 });

    const recoveryPanel = page.getByLabel("回復用の本文");
    await expect(recoveryPanel).toHaveCount(0);
  });

  test("複数の孤立下書きがある場合も選ばれなかった本文を削除しない", async ({ page }) => {
    await gotoApp(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const newestMarker = `newest-orphan-${Date.now()}`;
    const olderMarker = `older-orphan-${Date.now()}`;
    const newestTabId = `closed-newest-${Date.now()}`;
    const olderTabId = `closed-older-${Date.now()}`;
    const newestDirtyAt = new Date().toISOString();
    const olderDirtyAt = new Date(Date.now() - 60_000).toISOString();
    const record = await idbGet(page, MEMO_STORE, MEMO_ID);
    const baseRevision = Math.max(1, Number(record.contentRevision) || 1);
    await idbPut(page, MEMO_STORE, {
      ...record,
      content: newestMarker,
      _contentDirtyAt: newestDirtyAt,
      _contentDirtyOwner: newestTabId,
      _draftBaseRevision: baseRevision,
    });
    await idbPut(page, "documentDrafts", {
      key: `${olderTabId}:${MEMO_STORE}:${MEMO_ID}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      tabId: olderTabId,
      content: olderMarker,
      baseRevision,
      mutationId: `${olderTabId}-mutation`,
      dirtyAt: olderDirtyAt,
    });
    await idbPut(page, "documentDrafts", {
      key: `${newestTabId}:${MEMO_STORE}:${MEMO_ID}`,
      storeName: MEMO_STORE,
      id: MEMO_ID,
      tabId: newestTabId,
      content: newestMarker,
      baseRevision,
      mutationId: `${newestTabId}-mutation`,
      dirtyAt: newestDirtyAt,
    });

    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText(newestMarker, { timeout: 5_000 });

    const currentTabId = await page.evaluate(() => sessionStorage.getItem("gas_pomodoro_tab_id"));
    const drafts = await idbGetAll(page, "documentDrafts");
    expect(
      drafts.some((draft) => draft.tabId === currentTabId && draft.content === newestMarker),
    ).toBe(true);
    const preserved = drafts.find((draft) => draft.tabId === olderTabId);
    expect(preserved.content).toBe(olderMarker);
    expect(preserved.recoveryState).toBe("conflicting");
  });

  test("リモート本文の画像変換中に始めた編集を上書きしない", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockImageDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const remoteMarker = `remote-image-${Date.now()}`;
    const localMarker = `local-during-transform-${Date.now()}`;
    const imageRequest = pageB.waitForEvent("console", {
      predicate: (message) => message.text().includes("[mock] serverCall: getImageBase64"),
      timeout: 10_000,
    });
    await switchToMarkdownMode(pageA);
    await pageA
      .locator(".mdg-raw-editor")
      .fill(
        [
          `# ${remoteMarker}`,
          "",
          "![slow](https://drive.google.com/file/d/mock-image-delay/view)",
        ].join("\n"),
      );

    await imageRequest;
    await typeInEditor(pageB, localMarker);

    await expect(pageB.locator('[data-status="conflict"]')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator(".ProseMirror")).toContainText(localMarker);
    await expect(pageB.locator(".ProseMirror")).not.toContainText(remoteMarker);
  });

  test("最新版を反映する画像変換中に始めた編集を上書きしない", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await gotoApp(pageA);
    await gotoApp(pageB, { params: { mockDelay: "1500", mockImageDelay: "1500" } });
    await Promise.all([selectMemo(pageA, "開発メモ"), selectMemo(pageB, "開発メモ")]);
    await Promise.all([waitForSyncComplete(pageA), waitForSyncComplete(pageB)]);

    const discardedMarker = `discarded-local-${Date.now()}`;
    const remoteMarker = `accepted-image-${Date.now()}`;
    const newLocalMarker = `local-during-accept-${Date.now()}`;
    await typeInEditor(pageB, discardedMarker);
    await pageB.waitForTimeout(300);
    await switchToMarkdownMode(pageA);
    await pageA
      .locator(".mdg-raw-editor")
      .fill(
        [
          `# ${remoteMarker}`,
          "",
          "![slow](https://drive.google.com/file/d/mock-image-delay/view)",
        ].join("\n"),
      );

    const conflict = pageB.locator('[data-status="conflict"]');
    await expect(conflict).toBeVisible({ timeout: 10_000 });
    const imageRequest = pageB.waitForEvent("console", {
      predicate: (message) => message.text().includes("[mock] serverCall: getImageBase64"),
      timeout: 10_000,
    });
    await conflict.getByRole("button", { name: "最新版を反映" }).click();
    await imageRequest;
    await typeInEditor(pageB, newLocalMarker);

    await expect(pageB.locator('[data-status="conflict"]')).toBeVisible({ timeout: 5_000 });
    await expect(pageB.locator(".ProseMirror")).toContainText(newLocalMarker);
    await expect(pageB.locator(".ProseMirror")).not.toContainText(remoteMarker);
  });
});
