/**
 * IDB helpers for E2E tests
 * Run IndexedDB operations inside the browser context via page.evaluate
 */
import type { Page } from "@playwright/test";

export async function idbGet(page: Page, storeName: string, id: string): Promise<any> {
  return page.evaluate(
    ({ storeName, id }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 3);
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
        const req = indexedDB.open("gas_pomodoro", 3);
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

export async function idbGetAll(page: Page, storeName: string): Promise<any[]> {
  return page.evaluate(
    ({ storeName }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 3);
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

export async function clearDirtyAt(page: Page, storeName: string, id: string): Promise<void> {
  await page.evaluate(
    ({ storeName, id }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("gas_pomodoro", 3);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const getReq = store.get(id);
          getReq.onsuccess = () => {
            const record = getReq.result;
            if (!record) {
              resolve();
              return;
            }
            record._contentDirtyAt = null;
            store.put(record);
            tx.oncomplete = () => resolve();
          };
          getReq.onerror = () => reject(getReq.error);
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    { storeName, id },
  );
}
