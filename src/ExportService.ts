// Export projects, cases, tasks, pomodoro history and their referenced Drive images
// for scripts/export-to-vscode.ts.
// Run exportForVscode() from the Apps Script editor; re-run it if it stops before copying all images.

const VSCODE_EXPORT_FOLDER_NAME = "PomodoroVSCodeExport";
const VSCODE_EXPORT_FORMAT = 2;
// Stay below the 6-minute execution limit so data.json is always written.
const VSCODE_EXPORT_TIME_BUDGET_MS = 4.5 * 60 * 1000;
const VSCODE_EXPORT_DRIVE_URL_RE = /https:\/\/drive\.google\.com\/file\/d\/([^/\s)"'?#]+)\/view/g;
const VSCODE_EXPORT_EXTENSIONS: { [mimeType: string]: string } = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function exportForVscode(): void {
  const startedAt = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timeZone = ss.getSpreadsheetTimeZone();

  const toTimestamp = (value: unknown): string => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
    return String(value ?? "").trim();
  };
  // Task dates may be sheet dates, YYYY-MM-DD strings, or ISO timestamps copied from records.
  const toCalendarDate = (value: unknown): string => {
    if (value instanceof Date) return readTaskDateValue(value, timeZone);
    const text = String(value ?? "").trim();
    if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
  };
  const toActive = (value: unknown): boolean =>
    value !== false && String(value).trim().toUpperCase() !== "FALSE";
  const readRows = (sheetName: string, width: number): unknown[][] => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return [];
    return sheet
      .getRange(2, 1, sheet.getLastRow() - 1, width)
      .getValues()
      .filter((row) => String(row[0] ?? "").trim() !== "");
  };

  const projects = readRows("Projects", 8).map((row) => ({
    id: String(row[0]),
    name: String(row[1] ?? ""),
    content: String(row[2] ?? ""),
    color: String(row[3] ?? ""),
    sortOrder: Number(row[4]),
    isActive: toActive(row[5]),
    createdAt: toTimestamp(row[6]),
    updatedAt: toTimestamp(row[7]),
  }));
  const cases = readRows("Cases", 13).map((row) => ({
    id: String(row[0]),
    projectId: String(row[1] ?? ""),
    name: String(row[2] ?? ""),
    content: String(row[3] ?? ""),
    sortOrder: Number(row[4]),
    isActive: toActive(row[5]),
    createdAt: toTimestamp(row[6]),
    updatedAt: toTimestamp(row[7]),
    color: String(row[12] ?? ""),
  }));
  const tasks = readRows("Tasks", 13).map((row) => ({
    id: String(row[0]),
    projectId: String(row[1] ?? ""),
    caseId: String(row[2] ?? ""),
    name: String(row[3] ?? ""),
    content: String(row[4] ?? ""),
    status: String(row[5] ?? ""),
    sortOrder: Number(row[6]),
    isActive: toActive(row[7]),
    createdAt: toTimestamp(row[8]),
    completedAt: toTimestamp(row[9]),
    startedAt: toCalendarDate(row[10]),
    dueDate: toCalendarDate(row[11]),
    updatedAt: toTimestamp(row[12]),
  }));

  const records = readRows("PomodoroLog", 18).map((row) => ({
    id: String(row[0]),
    startTime: toTimestamp(row[2]),
    endTime: toTimestamp(row[3]),
    type: String(row[6] ?? ""),
    content: String(row[7] ?? ""),
    category: String(row[8] ?? ""),
    completionStatus: String(row[13] ?? ""),
    pomodoroSetIndex: Number(row[14]),
    taskId: String(row[15] ?? ""),
    projectId: String(row[16] ?? ""),
    caseId: String(row[17] ?? ""),
  }));
  const interruptions = readRows("Interruptions", 8).map((row) => ({
    id: String(row[0]),
    pomodoroId: String(row[1] ?? ""),
    type: String(row[2] ?? ""),
    startTime: toTimestamp(row[3]),
    endTime: toTimestamp(row[4]),
    category: String(row[6] ?? ""),
    content: String(row[7] ?? ""),
  }));
  const readCategories = (sheetName: string) =>
    readRows(sheetName, 4).map((row) => ({
      name: String(row[0]),
      color: String(row[1] ?? ""),
      sortOrder: Number(row[2]),
      isActive: toActive(row[3]),
    }));
  const categories = readCategories("Categories");
  const interruptionCategories = readCategories("InterruptionCategories");

  const fileIds: string[] = [];
  const seenFileIds: { [fileId: string]: true } = {};
  for (const doc of [...projects, ...cases, ...tasks, ...records, ...interruptions]) {
    for (const match of doc.content.matchAll(VSCODE_EXPORT_DRIVE_URL_RE)) {
      if (seenFileIds[match[1]]) continue;
      seenFileIds[match[1]] = true;
      fileIds.push(match[1]);
    }
  }

  const folders = DriveApp.getFoldersByName(VSCODE_EXPORT_FOLDER_NAME);
  const folder = folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(VSCODE_EXPORT_FOLDER_NAME);
  const imageFolders = folder.getFoldersByName("images");
  const imageFolder = imageFolders.hasNext() ? imageFolders.next() : folder.createFolder("images");
  const copied: { [name: string]: true } = {};
  const existing = imageFolder.getFiles();
  while (existing.hasNext()) copied[existing.next().getName()] = true;

  const images: { fileId: string; fileName: string; mimeType: string }[] = [];
  const failedImages: { fileId: string; error: string }[] = [];
  const pendingImages: string[] = [];
  for (const fileId of fileIds) {
    if (Date.now() - startedAt > VSCODE_EXPORT_TIME_BUDGET_MS) {
      pendingImages.push(fileId);
      continue;
    }
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();
      const extension = VSCODE_EXPORT_EXTENSIONS[mimeType];
      if (!extension) throw new Error("未対応の画像形式です: " + mimeType);
      const fileName = fileId + "." + extension;
      if (!copied[fileName]) {
        file.makeCopy(fileName, imageFolder);
        copied[fileName] = true;
      }
      images.push({ fileId, fileName, mimeType });
    } catch (error) {
      failedImages.push({ fileId, error: String(error) });
    }
  }

  const data = {
    format: VSCODE_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    timeZone,
    projects,
    cases,
    tasks,
    records,
    interruptions,
    categories,
    interruptionCategories,
    images,
    failedImages,
    pendingImages,
  };
  const oldData = folder.getFilesByName("data.json");
  while (oldData.hasNext()) oldData.next().setTrashed(true);
  folder.createFile("data.json", JSON.stringify(data, null, 2), "application/json");

  Logger.log(
    "プロジェクト %s件・案件 %s件・タスク %s件・記録 %s件・中断 %s件、画像 %s/%s件を書き出しました。",
    projects.length,
    cases.length,
    tasks.length,
    records.length,
    interruptions.length,
    images.length,
    fileIds.length,
  );
  if (failedImages.length) Logger.log("取得できなかった画像: %s", JSON.stringify(failedImages));
  if (pendingImages.length) {
    Logger.log(
      "時間切れで %s 件の画像が残っています。もう一度実行してください。",
      pendingImages.length,
    );
  }
  Logger.log("出力先: %s", folder.getUrl());
}
