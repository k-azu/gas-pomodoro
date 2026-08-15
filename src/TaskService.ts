interface ProjectMetadata {
  id: string;
  name: string;
  content: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contentRevision: number;
  metadataRevision: number;
  lastContentMutationId: string;
  lastMetadataMutationId: string;
}

interface CaseMetadata {
  id: string;
  projectId: string;
  name: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contentRevision: number;
  metadataRevision: number;
  lastContentMutationId: string;
  lastMetadataMutationId: string;
}

interface TaskMetadata {
  id: string;
  projectId: string;
  caseId: string;
  name: string;
  content: string;
  status: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  completedAt: string;
  startedAt: string;
  dueDate: string;
  updatedAt: string;
  contentRevision: number;
  metadataRevision: number;
  lastContentMutationId: string;
  lastMetadataMutationId: string;
  _cachedTimeSeconds?: number;
  _cachedPomodoroCount?: number;
}

function getAllTaskData(includeRecordStats = true): {
  projects: ProjectMetadata[];
  cases: CaseMetadata[];
  tasks: TaskMetadata[];
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Read projects
  const projSheet = ss.getSheetByName("Projects")!;
  const projLastRow = projSheet.getLastRow();
  let projects: ProjectMetadata[] = [];
  if (projLastRow > 1) {
    const projData = projSheet.getRange(2, 1, projLastRow - 1, 12).getValues();
    projects = projData
      .map((row) => ({
        id: String(row[0]),
        name: String(row[1]),
        content: String(row[2]),
        color: String(row[3]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
        contentRevision: readRevision(row[8]),
        metadataRevision: readRevision(row[9]),
        lastContentMutationId: String(row[10] ?? ""),
        lastMetadataMutationId: String(row[11] ?? ""),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read cases
  const casesSheet = ss.getSheetByName("Cases")!;
  const casesLastRow = casesSheet.getLastRow();
  let cases: CaseMetadata[] = [];
  if (casesLastRow > 1) {
    const casesData = casesSheet.getRange(2, 1, casesLastRow - 1, 12).getValues();
    cases = casesData
      .map((row) => ({
        id: String(row[0]),
        projectId: String(row[1]),
        name: String(row[2]),
        content: String(row[3]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
        contentRevision: readRevision(row[8]),
        metadataRevision: readRevision(row[9]),
        lastContentMutationId: String(row[10] ?? ""),
        lastMetadataMutationId: String(row[11] ?? ""),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read tasks
  const tasksSheet = ss.getSheetByName("Tasks")!;
  const tasksLastRow = tasksSheet.getLastRow();
  let tasks: TaskMetadata[] = [];
  if (tasksLastRow > 1) {
    const tasksData = tasksSheet.getRange(2, 1, tasksLastRow - 1, 17).getValues();
    tasks = tasksData
      .map((row) => ({
        id: String(row[0]),
        projectId: String(row[1]),
        caseId: String(row[2]),
        name: String(row[3]),
        content: String(row[4]),
        status: String(row[5]),
        sortOrder: Number(row[6]),
        isActive: Boolean(row[7]),
        createdAt: String(row[8]),
        completedAt: String(row[9]),
        startedAt: String(row[10]),
        dueDate: String(row[11]),
        updatedAt: String(row[12]),
        contentRevision: readRevision(row[13]),
        metadataRevision: readRevision(row[14]),
        lastContentMutationId: String(row[15] ?? ""),
        lastMetadataMutationId: String(row[16] ?? ""),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Aggregate _cachedTimeSeconds from PomodoroLog column P (taskId)
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = includeRecordStats ? logSheet.getLastRow() : 0;
  if (includeRecordStats && logLastRow > 1) {
    // Read taskId (col 16) and actualDurationSeconds (col 6)
    const logData = logSheet.getRange(2, 1, logLastRow - 1, 18).getValues();
    const timeByTaskId: { [taskId: string]: number } = {};
    const countByTaskId: { [taskId: string]: number } = {};
    logData.forEach((row) => {
      const taskId = String(row[15]);
      if (!taskId) return;
      const type = String(row[6]);
      if (type !== "work") return;
      const actualSeconds = Number(row[5]);
      timeByTaskId[taskId] = (timeByTaskId[taskId] || 0) + actualSeconds;
      countByTaskId[taskId] = (countByTaskId[taskId] || 0) + 1;
    });

    // Assign to tasks
    tasks.forEach((t) => {
      if (timeByTaskId[t.id]) t._cachedTimeSeconds = timeByTaskId[t.id];
      if (countByTaskId[t.id]) t._cachedPomodoroCount = countByTaskId[t.id];
    });
  }

  return { projects, cases, tasks };
}

function getProjectContent(id: string): { id: string; content: string; updatedAt: string } | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Projects")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      return {
        id,
        content: String(data[i][2]),
        updatedAt: String(data[i][7]),
      };
    }
  }
  return null;
}

function getCaseContent(id: string): { id: string; content: string; updatedAt: string } | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cases")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      return {
        id,
        content: String(data[i][3]),
        updatedAt: String(data[i][7]),
      };
    }
  }
  return null;
}

function getTaskContent(id: string): { id: string; content: string; updatedAt: string } | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tasks")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      return {
        id,
        content: String(data[i][4]),
        updatedAt: String(data[i][12]),
      };
    }
  }
  return null;
}

function addProject(
  id: string,
  name: string,
  color: string,
): { success: boolean; id: string; updatedAt: string } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Projects")!;
    const existingRow = findDocumentRow(sheet, id);
    if (existingRow !== null) {
      const existing = sheet.getRange(existingRow, 1, 1, 12).getValues()[0];
      const isSameCreation =
        String(existing[1]) === name &&
        String(existing[2]) === "" &&
        String(existing[3]) === color &&
        readRevision(existing[8]) === 0 &&
        readRevision(existing[9]) === 0;
      return { success: isSameCreation, id, updatedAt: String(existing[7] ?? "") };
    }
    const now = new Date().toISOString();
    const lastRow = sheet.getLastRow();
    const nextOrder = lastRow;
    sheet.appendRow([id, name, "", color, nextOrder, true, now, now, 0, 0, "", ""]);
    return { success: true, id, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function addCase(
  id: string,
  projectId: string,
  name: string,
): { success: boolean; id: string; updatedAt: string } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Cases")!;
    const existingRow = findDocumentRow(sheet, id);
    if (existingRow !== null) {
      const existing = sheet.getRange(existingRow, 1, 1, 12).getValues()[0];
      const isSameCreation =
        String(existing[1]) === projectId &&
        String(existing[2]) === name &&
        String(existing[3]) === "" &&
        readRevision(existing[8]) === 0 &&
        readRevision(existing[9]) === 0;
      return { success: isSameCreation, id, updatedAt: String(existing[7] ?? "") };
    }
    const now = new Date().toISOString();
    const lastRow = sheet.getLastRow();
    const nextOrder = lastRow;
    sheet.appendRow([id, projectId, name, "", nextOrder, true, now, now, 0, 0, "", ""]);
    return { success: true, id, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function addTask(
  id: string,
  projectId: string,
  caseId: string,
  name: string,
): { success: boolean; id: string; updatedAt: string } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Tasks")!;
    const existingRow = findDocumentRow(sheet, id);
    if (existingRow !== null) {
      const existing = sheet.getRange(existingRow, 1, 1, 17).getValues()[0];
      const isSameCreation =
        String(existing[1]) === projectId &&
        String(existing[2]) === (caseId || "") &&
        String(existing[3]) === name &&
        String(existing[4]) === "" &&
        readRevision(existing[13]) === 0 &&
        readRevision(existing[14]) === 0;
      return { success: isSameCreation, id, updatedAt: String(existing[12] ?? "") };
    }
    const now = new Date().toISOString();
    const lastRow = sheet.getLastRow();
    const nextOrder = lastRow;
    sheet.appendRow([
      id,
      projectId,
      caseId || "",
      name,
      "",
      "todo",
      nextOrder,
      true,
      now,
      "",
      "",
      "",
      now,
      0,
      0,
      "",
      "",
    ]);
    return { success: true, id, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function updateProject(
  _id: string,
  _fields: { name?: string; color?: string; content?: string },
): { success: boolean; updatedAt?: string } {
  return rejectLegacyDocumentMutation();
}

function updateCase(
  _id: string,
  _fields: { name?: string; content?: string; isActive?: boolean },
): { success: boolean; updatedAt?: string } {
  return rejectLegacyDocumentMutation();
}

function updateTask(
  _id: string,
  _fields: {
    name?: string;
    content?: string;
    status?: string;
    startedAt?: string;
    dueDate?: string;
    isActive?: boolean;
  },
): { success: boolean; updatedAt?: string } {
  return rejectLegacyDocumentMutation();
}

function archiveProject(_id: string): { success: boolean } {
  return rejectLegacyDocumentMutation();
}

function archiveCase(_id: string): { success: boolean } {
  return rejectLegacyDocumentMutation();
}

function archiveTask(_id: string): { success: boolean } {
  return rejectLegacyDocumentMutation();
}

function reorderProjects(orderedIds: string[]): { success: boolean } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Projects")!;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false };

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const sortOrders = sheet.getRange(2, 5, lastRow - 1, 1).getValues();

    const orderMap: { [id: string]: number } = {};
    for (let i = 0; i < orderedIds.length; i++) {
      orderMap[orderedIds[i]] = i + 1;
    }

    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0]);
      if (orderMap[id] !== undefined && sortOrders[i][0] !== orderMap[id]) {
        sortOrders[i][0] = orderMap[id];
        changed = true;
      }
    }

    if (changed) {
      sheet.getRange(2, 5, lastRow - 1, 1).setValues(sortOrders);
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function reorderCases(_projectId: string, orderedIds: string[]): { success: boolean } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Cases")!;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false };

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const sortOrders = sheet.getRange(2, 5, lastRow - 1, 1).getValues();

    const orderMap: { [id: string]: number } = {};
    for (let i = 0; i < orderedIds.length; i++) {
      orderMap[orderedIds[i]] = i + 1;
    }

    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0]);
      if (orderMap[id] !== undefined && sortOrders[i][0] !== orderMap[id]) {
        sortOrders[i][0] = orderMap[id];
        changed = true;
      }
    }

    if (changed) {
      sheet.getRange(2, 5, lastRow - 1, 1).setValues(sortOrders);
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function reorderTasks(_parentId: string, orderedIds: string[]): { success: boolean } {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Tasks")!;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false };

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const sortOrders = sheet.getRange(2, 7, lastRow - 1, 1).getValues();

    const orderMap: { [id: string]: number } = {};
    for (let i = 0; i < orderedIds.length; i++) {
      orderMap[orderedIds[i]] = i + 1;
    }

    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0]);
      if (orderMap[id] !== undefined && sortOrders[i][0] !== orderMap[id]) {
        sortOrders[i][0] = orderMap[id];
        changed = true;
      }
    }

    if (changed) {
      sheet.getRange(2, 7, lastRow - 1, 1).setValues(sortOrders);
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function getTaskPomodoroRecords(taskId: string): PomodoroRecord[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const tz = Session.getScriptTimeZone();
  const data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  return data
    .filter((row) => String(row[15]) === taskId)
    .map((row) => readRecordFromRow(row, tz))
    .reverse();
}
