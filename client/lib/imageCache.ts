/**
 * Drive image IDB cache + blob URL management
 * Port of EditorManager.html image handling → standalone module.
 */

import { serverCall } from "./serverCall";

const DRIVE_FILE_RE = /drive\.google\.com\/file\/d\/([^/]+)\/view/;
const DRIVE_URL_GLOBAL_RE =
  /https:\/\/drive\.google\.com\/file\/d\/([^/\s)"]+)\/view/g;

const blobToDriveUrl: Record<string, string> = {};
const fileIdToBlobUrl: Record<string, string> = {};

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

const MAX_CLIENT_BYTES = 10 * 1024 * 1024;

export function handleImageUpload(file: File): Promise<string> {
  if (file.size > MAX_CLIENT_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return Promise.reject(
      new Error(`画像サイズが上限(10MB)を超えています: ${sizeMB}MB`),
    );
  }
  const mimeType = file.type || "image/jpeg";
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = extMap[mimeType] || "jpg";
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

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      serverCall("uploadImage", base64, uploadName, mimeType)
        .then((result: any) => {
          const blob = new Blob([file], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          registerBlobUrl(result.fileId, blobUrl);
          setCachedImage(result.fileId, blob);
          resolve(blobUrl);
        })
        .catch(reject);
    };
    reader.onerror = () => {
      reject(new Error("ファイルの読み込みに失敗しました"));
    };
    reader.readAsDataURL(file);
  });
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
