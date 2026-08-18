type DocumentStoreName = "memos" | "projects" | "cases" | "tasks";

interface DocumentSheetConfig {
  sheetName: string;
  contentColumn: number;
  updatedAtColumn: number;
  isActiveColumn: number;
  contentRevisionColumn: number;
  metadataRevisionColumn: number;
  lastContentMutationColumn: number;
  lastMetadataMutationColumn: number;
  metadataColumns: Record<string, number>;
}

interface DocumentContentSnapshot {
  documentKey: string;
  content: string;
  revision: number;
  updatedAt: string;
  lastMutationId: string;
}

interface DocumentMetadataSnapshot {
  documentKey: string;
  revision: number;
  updatedAt: string;
  lastMutationId: string;
  metadata: Record<string, unknown>;
}

interface PutDocumentContentRequest {
  documentKey: string;
  content: string;
  expectedRevision: number;
  mutationId: string;
}

interface PatchDocumentMetadataRequest {
  documentKey: string;
  patch: Record<string, unknown>;
  expectedRevision: number;
  mutationId: string;
}

type DocumentContentMutationResult =
  | { status: "applied"; mutationId: string; snapshot: DocumentContentSnapshot }
  | { status: "conflict"; mutationId: string; snapshot: DocumentContentSnapshot }
  | { status: "missing"; mutationId: string };

type DocumentMetadataMutationResult =
  | { status: "applied"; mutationId: string; snapshot: DocumentMetadataSnapshot }
  | { status: "conflict"; mutationId: string; snapshot: DocumentMetadataSnapshot }
  | { status: "missing"; mutationId: string }
  | { status: "rejected"; mutationId: string; reason: string };

const DOCUMENT_SHEETS: Record<DocumentStoreName, DocumentSheetConfig> = {
  memos: {
    sheetName: "Memos",
    contentColumn: 3,
    updatedAtColumn: 6,
    isActiveColumn: 8,
    contentRevisionColumn: 9,
    metadataRevisionColumn: 10,
    lastContentMutationColumn: 11,
    lastMetadataMutationColumn: 12,
    metadataColumns: { name: 2, tags: 4, isActive: 8 },
  },
  projects: {
    sheetName: "Projects",
    contentColumn: 3,
    updatedAtColumn: 8,
    isActiveColumn: 6,
    contentRevisionColumn: 9,
    metadataRevisionColumn: 10,
    lastContentMutationColumn: 11,
    lastMetadataMutationColumn: 12,
    metadataColumns: { name: 2, color: 4, isActive: 6 },
  },
  cases: {
    sheetName: "Cases",
    contentColumn: 4,
    updatedAtColumn: 8,
    isActiveColumn: 6,
    contentRevisionColumn: 9,
    metadataRevisionColumn: 10,
    lastContentMutationColumn: 11,
    lastMetadataMutationColumn: 12,
    metadataColumns: { projectId: 2, name: 3, isActive: 6 },
  },
  tasks: {
    sheetName: "Tasks",
    contentColumn: 5,
    updatedAtColumn: 13,
    isActiveColumn: 8,
    contentRevisionColumn: 14,
    metadataRevisionColumn: 15,
    lastContentMutationColumn: 16,
    lastMetadataMutationColumn: 17,
    metadataColumns: {
      projectId: 2,
      caseId: 3,
      name: 4,
      status: 6,
      isActive: 8,
      startedAt: 11,
      dueDate: 12,
    },
  },
};

function parseDocumentKey(documentKey: string): {
  storeName: DocumentStoreName;
  id: string;
  config: DocumentSheetConfig;
} {
  const separator = documentKey.indexOf(":");
  if (separator <= 0) throw new Error("Invalid document key");
  const storeName = documentKey.slice(0, separator) as DocumentStoreName;
  const id = documentKey.slice(separator + 1);
  const config = DOCUMENT_SHEETS[storeName];
  if (!config || !id) throw new Error("Invalid document key");
  return { storeName, id, config };
}

function readRevision(value: unknown): number {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function findDocumentRow(sheet: GoogleAppsScript.Spreadsheet.Sheet, id: string): number | null {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (String(ids[index][0]) === id) return index + 2;
  }
  return null;
}

function documentRowWidth(config: DocumentSheetConfig): number {
  return Math.max(
    config.contentColumn,
    config.updatedAtColumn,
    config.isActiveColumn,
    config.contentRevisionColumn,
    config.metadataRevisionColumn,
    config.lastContentMutationColumn,
    config.lastMetadataMutationColumn,
    ...Object.values(config.metadataColumns),
  );
}

function readContentSnapshotValues(
  values: unknown[],
  documentKey: string,
  config: DocumentSheetConfig,
): DocumentContentSnapshot {
  return {
    documentKey,
    content: String(values[config.contentColumn - 1] ?? ""),
    revision: readRevision(values[config.contentRevisionColumn - 1]),
    updatedAt: String(values[config.updatedAtColumn - 1] ?? ""),
    lastMutationId: String(values[config.lastContentMutationColumn - 1] ?? ""),
  };
}

function readMetadataValue(
  storeName: DocumentStoreName,
  field: string,
  value: unknown,
  timeZone: string,
): unknown {
  if (storeName === "memos" && field === "tags") return parseTags(value);
  if (field === "isActive") return value === true;
  if (storeName === "tasks" && (field === "startedAt" || field === "dueDate")) {
    return readTaskDateValue(value, timeZone);
  }
  return String(value ?? "");
}

function readMetadataSnapshotValues(
  values: unknown[],
  documentKey: string,
  storeName: DocumentStoreName,
  config: DocumentSheetConfig,
): DocumentMetadataSnapshot {
  const metadata: Record<string, unknown> = {};
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  Object.entries(config.metadataColumns).forEach(([field, column]) => {
    metadata[field] = readMetadataValue(storeName, field, values[column - 1], timeZone);
  });
  if (storeName === "tasks") {
    metadata.completedAt = String(values[9] ?? "");
  }
  return {
    documentKey,
    revision: readRevision(values[config.metadataRevisionColumn - 1]),
    updatedAt: String(values[config.updatedAtColumn - 1] ?? ""),
    lastMutationId: String(values[config.lastMetadataMutationColumn - 1] ?? ""),
    metadata,
  };
}

function validateMutationRequest(request: { expectedRevision: number; mutationId: string }): void {
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error("Invalid expected revision");
  }
  if (!request.mutationId) throw new Error("mutationId is required");
}

function putDocumentContent(request: PutDocumentContentRequest): DocumentContentMutationResult {
  validateMutationRequest(request);
  if (typeof request.content !== "string") throw new Error("Invalid document content");

  const { storeName, id, config } = parseDocumentKey(request.documentKey);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName)!;
    const row = findDocumentRow(sheet, id);
    if (row === null) return { status: "missing", mutationId: request.mutationId };
    const rowRange = sheet.getRange(row, 1, 1, documentRowWidth(config));
    const values = rowRange.getValues()[0];
    const current = readContentSnapshotValues(values, request.documentKey, config);
    if (current.lastMutationId === request.mutationId) {
      return { status: "applied", mutationId: request.mutationId, snapshot: current };
    }
    if (storeName === "memos" && values[config.isActiveColumn - 1] !== true) {
      return { status: "missing", mutationId: request.mutationId };
    }
    if (current.revision !== request.expectedRevision) {
      return { status: "conflict", mutationId: request.mutationId, snapshot: current };
    }

    const now = new Date().toISOString();
    values[config.contentColumn - 1] = request.content;
    values[config.updatedAtColumn - 1] = now;
    values[config.contentRevisionColumn - 1] = current.revision + 1;
    values[config.lastContentMutationColumn - 1] = request.mutationId;
    rowRange.setValues([values]);
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: {
        documentKey: request.documentKey,
        content: request.content,
        revision: current.revision + 1,
        updatedAt: now,
        lastMutationId: request.mutationId,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

function serializeMetadataValue(
  storeName: DocumentStoreName,
  field: string,
  value: unknown,
): unknown {
  if (storeName === "memos" && field === "tags") {
    if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
      throw new Error("Invalid memo tags");
    }
    return JSON.stringify(value);
  }
  if (field === "isActive") {
    if (typeof value !== "boolean") throw new Error("Invalid isActive value");
    return value;
  }
  if (typeof value !== "string") throw new Error(`Invalid metadata field ${field}`);
  return value;
}

function patchDocumentMetadata(
  request: PatchDocumentMetadataRequest,
): DocumentMetadataMutationResult {
  validateMutationRequest(request);
  if (!request.patch || typeof request.patch !== "object" || Array.isArray(request.patch)) {
    throw new Error("Invalid metadata patch");
  }

  const { storeName, id, config } = parseDocumentKey(request.documentKey);
  const fields = Object.keys(request.patch);
  if (fields.length === 0) {
    return { status: "rejected", mutationId: request.mutationId, reason: "empty patch" };
  }
  const invalidField = fields.find((field) => config.metadataColumns[field] === undefined);
  if (invalidField) {
    return {
      status: "rejected",
      mutationId: request.mutationId,
      reason: `unsupported field: ${invalidField}`,
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName)!;
    const row = findDocumentRow(sheet, id);
    if (row === null) return { status: "missing", mutationId: request.mutationId };

    const rowRange = sheet.getRange(row, 1, 1, documentRowWidth(config));
    const values = rowRange.getValues()[0];
    const current = readMetadataSnapshotValues(values, request.documentKey, storeName, config);
    if (current.lastMutationId === request.mutationId) {
      return { status: "applied", mutationId: request.mutationId, snapshot: current };
    }
    if (
      storeName === "memos" &&
      current.metadata.isActive === false &&
      !(fields.length === 1 && request.patch.isActive === true)
    ) {
      return {
        status: "rejected",
        mutationId: request.mutationId,
        reason: "archived document is read-only",
      };
    }
    if (current.revision !== request.expectedRevision) {
      return { status: "conflict", mutationId: request.mutationId, snapshot: current };
    }

    const oldStatus = storeName === "tasks" ? String(current.metadata.status ?? "") : "";
    fields.forEach((field) => {
      const column = config.metadataColumns[field];
      values[column - 1] = serializeMetadataValue(storeName, field, request.patch[field]);
    });
    if (storeName === "tasks" && request.patch.status !== undefined) {
      const newStatus = String(request.patch.status);
      if (newStatus === "done" && oldStatus !== "done") {
        values[9] = new Date().toISOString();
      } else if (newStatus !== "done" && oldStatus === "done") {
        values[9] = "";
      }
    }

    const now = new Date().toISOString();
    const nextRevision = current.revision + 1;
    values[config.updatedAtColumn - 1] = now;
    values[config.metadataRevisionColumn - 1] = nextRevision;
    values[config.lastMetadataMutationColumn - 1] = request.mutationId;
    rowRange.setValues([values]);
    return {
      status: "applied",
      mutationId: request.mutationId,
      snapshot: readMetadataSnapshotValues(values, request.documentKey, storeName, config),
    };
  } finally {
    lock.releaseLock();
  }
}

function getDocumentViewData(documentKey: string): {
  memos: MemoMetadata[];
  projects: ProjectMetadata[];
  cases: CaseMetadata[];
  tasks: TaskMetadata[];
} {
  const { storeName, id, config } = parseDocumentKey(documentKey);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName)!;
  const row = findDocumentRow(sheet, id);
  const result = {
    memos: [] as MemoMetadata[],
    projects: [] as ProjectMetadata[],
    cases: [] as CaseMetadata[],
    tasks: [] as TaskMetadata[],
  };
  if (row === null) return result;

  if (storeName === "memos") {
    const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
    result.memos.push({
      id: String(values[0]),
      name: String(values[1]),
      content: String(values[2]),
      tags: parseTags(values[3]),
      createdAt: String(values[4]),
      updatedAt: String(values[5]),
      sortOrder: Number(values[6]),
      isActive: Boolean(values[7]),
      contentRevision: readRevision(values[8]),
      metadataRevision: readRevision(values[9]),
      lastContentMutationId: String(values[10] ?? ""),
      lastMetadataMutationId: String(values[11] ?? ""),
    });
    return result;
  }

  if (storeName === "projects") {
    const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
    result.projects.push({
      id: String(values[0]),
      name: String(values[1]),
      content: String(values[2]),
      color: String(values[3]),
      sortOrder: Number(values[4]),
      isActive: Boolean(values[5]),
      createdAt: String(values[6]),
      updatedAt: String(values[7]),
      contentRevision: readRevision(values[8]),
      metadataRevision: readRevision(values[9]),
      lastContentMutationId: String(values[10] ?? ""),
      lastMetadataMutationId: String(values[11] ?? ""),
    });
    return result;
  }

  if (storeName === "cases") {
    const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
    result.cases.push({
      id: String(values[0]),
      projectId: String(values[1]),
      name: String(values[2]),
      content: String(values[3]),
      sortOrder: Number(values[4]),
      isActive: Boolean(values[5]),
      createdAt: String(values[6]),
      updatedAt: String(values[7]),
      contentRevision: readRevision(values[8]),
      metadataRevision: readRevision(values[9]),
      lastContentMutationId: String(values[10] ?? ""),
      lastMetadataMutationId: String(values[11] ?? ""),
    });
    return result;
  }

  const values = sheet.getRange(row, 1, 1, 17).getValues()[0];
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  result.tasks.push({
    id: String(values[0]),
    projectId: String(values[1]),
    caseId: String(values[2]),
    name: String(values[3]),
    content: String(values[4]),
    status: String(values[5]),
    sortOrder: Number(values[6]),
    isActive: Boolean(values[7]),
    createdAt: String(values[8]),
    completedAt: String(values[9]),
    startedAt: readTaskDateValue(values[10], timeZone),
    dueDate: readTaskDateValue(values[11], timeZone),
    updatedAt: String(values[12]),
    contentRevision: readRevision(values[13]),
    metadataRevision: readRevision(values[14]),
    lastContentMutationId: String(values[15] ?? ""),
    lastMetadataMutationId: String(values[16] ?? ""),
  });
  return result;
}
