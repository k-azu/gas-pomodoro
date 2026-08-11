import { selectDocumentContent } from "./documentContentModel";
import { subscribeDocumentInvalidation } from "./documentInvalidation";
import { readDocumentContent } from "./documentRepository";
import { DocumentContentStore, type DocumentContentListener } from "./documentContentStoreCore";

export { DocumentContentStore } from "./documentContentStoreCore";

const documentContentStore = new DocumentContentStore(async (storeName, id) => {
  if (
    Boolean((import.meta as any).env?.DEV) &&
    typeof window !== "undefined" &&
    (window as any).__mockLocalLoadShouldFailOnce
  ) {
    (window as any).__mockLocalLoadShouldFailOnce = false;
    throw new Error("Mock: forced local load error");
  }
  const state = await readDocumentContent(storeName, id);
  return state ? selectDocumentContent(state) : null;
});

if (typeof window !== "undefined") {
  subscribeDocumentInvalidation((event) => {
    documentContentStore.invalidate(event.storeName, event.id);
  });
}

export function refreshDocumentContent(storeName: string, id: string) {
  return documentContentStore.refresh(storeName, id);
}

export function getCachedDocumentContent(storeName: string, id: string) {
  return documentContentStore.getSnapshot(storeName, id);
}

export function subscribeDocumentContent(
  storeName: string,
  id: string,
  listener: DocumentContentListener,
): () => void {
  return documentContentStore.subscribe(storeName, id, listener);
}
