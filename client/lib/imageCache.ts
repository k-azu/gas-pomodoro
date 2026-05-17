/**
 * Drive image IDB cache + blob URL management
 * Port of EditorManager.html image handling → standalone module.
 */

import { serverCall } from "./serverCall";

const DRIVE_URL_GLOBAL_RE = /https:\/\/drive\.google\.com\/file\/d\/([^/\s)"]+)\/view/g;
const DRIVE_FILE_URL_RE = /^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/view/;
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_CLIENT_BYTES = 10 * 1024 * 1024;

const blobToDriveUrl: Record<string, string> = {};
const fileIdToBlobUrl: Record<string, string> = {};
const uploadingClipboardSources = new Set<string>();

const IMG_DB_NAME = "gas_pomodoro_images";
const IMG_DB_VERSION = 1;
const IMG_STORE_NAME = "images";
let _imgDbInstance: IDBDatabase | null = null;

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// =========================================================
// Blob URL ↔ Drive URL conversion
// =========================================================

export function blobUrlsToDrive(md: string): string {
  for (const blobUrl in blobToDriveUrl) {
    md = md.split(blobUrl).join(blobToDriveUrl[blobUrl]);
  }
  return md;
}

export function getBlobToDriveUrl(): Readonly<Record<string, string>> {
  return blobToDriveUrl;
}

// =========================================================
// IndexedDB image cache
// =========================================================

function openImageDB(): Promise<IDBDatabase> {
  if (_imgDbInstance) return Promise.resolve(_imgDbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB_NAME, IMG_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMG_STORE_NAME);
    };
    req.onsuccess = () => {
      _imgDbInstance = req.result;
      resolve(_imgDbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

function getCachedImage(fileId: string): Promise<Blob | null> {
  return openImageDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IMG_STORE_NAME, "readonly");
        const req = tx.objectStore(IMG_STORE_NAME).get(fileId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function setCachedImage(fileId: string, blob: Blob): Promise<void> {
  return openImageDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IMG_STORE_NAME, "readwrite");
        tx.objectStore(IMG_STORE_NAME).put(blob, fileId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// =========================================================
// Resolve helpers
// =========================================================

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/png":
    default:
      return "png";
  }
}

function fileNameFromImageSrc(src: string, mimeType: string): string | undefined {
  try {
    const url = new URL(src, window.location.href);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (!lastSegment) return undefined;
    const decoded = decodeURIComponent(lastSegment);
    if (!decoded || decoded === "/" || decoded === "." || decoded.includes("\\")) return undefined;
    return /\.[a-z0-9]+$/i.test(decoded) ? decoded : `${decoded}.${extensionForMimeType(mimeType)}`;
  } catch {
    return undefined;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64) {
        reject(new Error("ファイルのBase64変換に失敗しました"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

async function fileFromImageSource(src: string): Promise<File> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`画像の取得に失敗しました: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!ALLOWED_IMAGE_MIMES.has(blob.type)) {
    throw new Error(`未対応の画像形式です: ${blob.type || "unknown"}`);
  }

  const fileName =
    fileNameFromImageSrc(src, blob.type) ?? `pasted-image.${extensionForMimeType(blob.type)}`;
  return new File([blob], fileName, { type: blob.type });
}

function registerBlobUrl(fileId: string, blobUrl: string): string {
  fileIdToBlobUrl[fileId] = blobUrl;
  blobToDriveUrl[blobUrl] = driveFileUrl(fileId);
  return blobUrl;
}

function resolveFileId(fileId: string): Promise<string> {
  if (fileIdToBlobUrl[fileId]) return Promise.resolve(fileIdToBlobUrl[fileId]);
  return getCachedImage(fileId)
    .then((cached) => {
      if (cached) {
        return registerBlobUrl(fileId, URL.createObjectURL(cached));
      }
      return serverCall("getImageBase64", fileId).then((result: any) => {
        const blob = base64ToBlob(result.base64, result.mimeType);
        setCachedImage(fileId, blob);
        return registerBlobUrl(fileId, URL.createObjectURL(blob));
      });
    })
    .catch((err) => {
      console.error("画像の解決に失敗:", fileId, err);
      return driveFileUrl(fileId);
    });
}

export function resolveDriveUrls(md: string): Promise<string> {
  if (!md) return Promise.resolve(md);
  const ids: Record<string, string> = {};
  let match: RegExpExecArray | null;
  DRIVE_URL_GLOBAL_RE.lastIndex = 0;
  while ((match = DRIVE_URL_GLOBAL_RE.exec(md)) !== null) {
    ids[match[1]] = match[0];
  }
  const keys = Object.keys(ids);
  if (keys.length === 0) return Promise.resolve(md);
  return Promise.all(
    keys.map((fileId) =>
      resolveFileId(fileId).then((blobUrl) => ({ driveUrl: ids[fileId], blobUrl })),
    ),
  ).then((results) => {
    results.forEach((r) => {
      md = md.split(r.driveUrl).join(r.blobUrl);
    });
    return md;
  });
}

// =========================================================
// Image upload
// =========================================================

export function handleImageUpload(file: File): Promise<string> {
  if (file.size > MAX_CLIENT_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return Promise.reject(new Error(`画像サイズが上限(10MB)を超えています: ${sizeMB}MB`));
  }
  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    return Promise.reject(new Error(`未対応の画像形式です: ${mimeType || "unknown"}`));
  }
  const ext = extensionForMimeType(mimeType);
  const now = new Date();
  const ts =
    now.getFullYear() +
    ("0" + (now.getMonth() + 1)).slice(-2) +
    ("0" + now.getDate()).slice(-2) +
    "_" +
    ("0" + now.getHours()).slice(-2) +
    ("0" + now.getMinutes()).slice(-2) +
    ("0" + now.getSeconds()).slice(-2);
  const uploadName = `pomodoro_${ts}.${ext}`;

  return fileToBase64(file).then((base64) =>
    serverCall("uploadImage", base64, uploadName, mimeType).then((result: any) => {
      if (!result?.fileId) {
        if (typeof result?.url === "string") return result.url;
        throw new Error("画像アップロード結果にfileIdが含まれていません");
      }
      const blob = file.slice(0, file.size, mimeType);
      const blobUrl = URL.createObjectURL(blob);
      registerBlobUrl(result.fileId, blobUrl);
      setCachedImage(result.fileId, blob);
      return blobUrl;
    }),
  );
}

// =========================================================
// Clipboard image upload fallback
// =========================================================

type ImageUploadResult = string | { markdownSrc: string; displaySrc?: string | null };

function normalizeUploadResult(result: ImageUploadResult): string {
  return typeof result === "string" ? result : result.markdownSrc;
}

function isUploadManaged(attrs: Record<string, unknown>): boolean {
  return attrs.uploadStatus === "uploading" || attrs.uploadStatus === "error";
}

function shouldUploadImageSource(src: string, attrs: Record<string, unknown>): boolean {
  if (!src || DRIVE_FILE_URL_RE.test(src) || isUploadManaged(attrs)) return false;
  return (
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  );
}

function collectImageSourcesFromClipboard(event: ClipboardEvent): string[] {
  const html = event.clipboardData?.getData("text/html");
  if (!html) return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]"))
    .map((img) => img.getAttribute("src") || "")
    .filter(Boolean);
}

function updateMatchingImages(
  editor: any,
  predicate: (node: any) => boolean,
  attrs: Record<string, unknown>,
): number {
  if (editor.isDestroyed) return 0;

  const updates: Array<{ pos: number; node: any }> = [];
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === "image" && predicate(node)) {
      updates.push({ pos, node });
    }
  });

  if (updates.length === 0) return 0;

  let tr = editor.state.tr;
  for (const { pos, node } of updates) {
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  }
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return updates.length;
}

async function uploadPastedImageSource(
  editor: any,
  src: string,
  onImageUpload: (file: File) => Promise<ImageUploadResult>,
): Promise<void> {
  if (uploadingClipboardSources.has(src)) return;
  uploadingClipboardSources.add(src);

  let previewUrl: string | null = null;
  try {
    const file = await fileFromImageSource(src);
    previewUrl = URL.createObjectURL(file);

    const updatedCount = updateMatchingImages(
      editor,
      (node) => node.attrs.src === src && shouldUploadImageSource(src, node.attrs),
      {
        src: previewUrl,
        alt: file.name || "pasted-image",
        uploadStatus: "uploading",
        uploadError: null,
      },
    );
    if (updatedCount === 0) return;

    const uploadedSrc = normalizeUploadResult(await onImageUpload(file));
    updateMatchingImages(editor, (node) => node.attrs.src === previewUrl, {
      src: uploadedSrc,
      uploadStatus: null,
      uploadError: null,
    });
  } catch (err) {
    console.warn("クリップボード画像のDriveアップロードをスキップしました:", src, err);
    if (previewUrl) {
      updateMatchingImages(editor, (node) => node.attrs.src === previewUrl, {
        src,
        uploadStatus: null,
        uploadError: null,
      });
    }
  } finally {
    uploadingClipboardSources.delete(src);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }
}

function uploadPastedImages(
  editor: any,
  sources: string[],
  onImageUpload: (file: File) => Promise<ImageUploadResult>,
): void {
  const sourceSet = new Set(sources);
  const uploadTargets = new Set<string>();

  editor.state.doc.descendants((node: any) => {
    if (node.type.name !== "image") return;
    const src = node.attrs.src;
    if (!sourceSet.has(src) || !shouldUploadImageSource(src, node.attrs)) return;
    uploadTargets.add(src);
  });

  for (const src of uploadTargets) {
    void uploadPastedImageSource(editor, src, onImageUpload);
  }
}

export function bindClipboardImageUpload(
  editor: any,
  onImageUpload: (file: File) => Promise<ImageUploadResult>,
): () => void {
  const handlePaste = (event: ClipboardEvent) => {
    const sources = collectImageSourcesFromClipboard(event).filter((src) =>
      shouldUploadImageSource(src, {}),
    );
    if (sources.length === 0) return;

    window.setTimeout(() => {
      uploadPastedImages(editor, sources, onImageUpload);
    }, 0);
  };

  let frame = 0;
  let boundDom: HTMLElement | null = null;

  const bind = () => {
    if (editor.isDestroyed) return;
    const dom = editor.view?.dom as HTMLElement | undefined;
    if (!dom) {
      frame = window.requestAnimationFrame(bind);
      return;
    }
    boundDom = dom;
    boundDom.addEventListener("paste", handlePaste);
  };

  bind();

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    boundDom?.removeEventListener("paste", handlePaste);
  };
}

// =========================================================
// Double-click to open Drive image
// =========================================================

let _dblclickBound = false;

export function bindDblclick(): void {
  if (_dblclickBound) return;
  _dblclickBound = true;
  document.addEventListener("dblclick", (e) => {
    const img = e.target as HTMLElement;
    if (img.tagName !== "IMG") return;
    const dUrl = blobToDriveUrl[(img as HTMLImageElement).src];
    if (dUrl) window.open(dUrl, "_blank");
  });
}
