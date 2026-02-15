const ALLOWED_IMAGE_MIMES: string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const IMAGE_FOLDER_NAME = "PomodoroImages";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function getOrCreateImageFolder(): GoogleAppsScript.Drive.Folder {
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(IMAGE_FOLDER_NAME);
}

function uploadImage(
  base64Data: string,
  fileName: string,
  mimeType: string,
): { fileId: string } {
  if (!ALLOWED_IMAGE_MIMES.includes(mimeType)) {
    throw new Error("許可されていない画像形式です: " + mimeType);
  }

  const decoded = Utilities.base64Decode(base64Data);
  if (decoded.length > MAX_IMAGE_BYTES) {
    throw new Error(
      "画像サイズが上限(10MB)を超えています: " +
        Math.round(decoded.length / 1024 / 1024) +
        "MB",
    );
  }

  const blob = Utilities.newBlob(decoded, mimeType, fileName);
  const folder = getOrCreateImageFolder();
  const file = folder.createFile(blob);

  return { fileId: file.getId() };
}

function getImageBase64(fileId: string): {
  base64: string;
  mimeType: string;
} {
  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();
  if (!ALLOWED_IMAGE_MIMES.includes(mimeType)) {
    throw new Error("許可されていない画像形式です: " + mimeType);
  }
  const blob = file.getBlob();
  const base64 = Utilities.base64Encode(blob.getBytes());
  return { base64, mimeType };
}
