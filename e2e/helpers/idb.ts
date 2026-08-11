/**
 * IDB helpers for E2E tests
 * Run IndexedDB operations inside the browser context via page.evaluate
 */
import type { Page } from "@playwright/test";

export async function idbGet(page: Page, storeName: string, id: string): Promise<any> {
  return page.evaluate(
    ({ storeName, id }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 6);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readonly");
          const getReq = tx.objectStore(storeName).get(id);
          getReq.onsuccess = () => resolve(getReq.result ?? null);
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, id },
  );
}

export async function idbPut(page: Page, storeName: string, data: any): Promise<void> {
  await page.evaluate(
    ({ storeName, data }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 6);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(data);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, data },
  );
}

/**
 * Seed unsynced local content.
 * This models a real local edit, so normal server content must not overwrite it during resolve.
 */
export async function idbSeedDirtyContent(
  page: Page,
  storeName: string,
  id: string,
  content: string,
): Promise<void> {
  const key = `${storeName}:${id}`;
  const body = await idbGet(page, "documentBodies", key);
  if (!body) {
    throw new Error(`Cannot seed missing IndexedDB record: ${storeName}/${id}`);
  }
  const updatedAt = new Date().toISOString();
  await idbPut(page, "activeDocumentDrafts", {
    kind: "pending",
    key,
    content,
    baseRevision: body.revision,
    mutationId: crypto.randomUUID(),
    localVersion: Date.now(),
    updatedAt,
  });
}

export async function idbGetDocumentContent(
  page: Page,
  storeName: string,
  id: string,
): Promise<{ body: any; draft: any; content: string }> {
  const key = `${storeName}:${id}`;
  const [body, draft] = await Promise.all([
    idbGet(page, "documentBodies", key),
    idbGet(page, "activeDocumentDrafts", key),
  ]);
  const content = draft
    ? draft.kind === "conflict"
      ? String(draft.localContent || "")
      : String(draft.content || "")
    : String(body?.content || "");
  return { body, draft, content };
}

export async function idbGetAll(page: Page, storeName: string): Promise<any[]> {
  return page.evaluate(
    ({ storeName }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 6);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readonly");
          const getReq = tx.objectStore(storeName).getAll();
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName },
  );
}

export async function idbDelete(page: Page, storeName: string, id: string): Promise<void> {
  await page.evaluate(
    ({ storeName, id }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 6);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, id },
  );
}

export async function clearDirtyAt(page: Page, storeName: string, id: string): Promise<void> {
  await idbDelete(page, "activeDocumentDrafts", `${storeName}:${id}`);
}
