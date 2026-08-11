interface ProjectMetadata {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contentRevision: number;
}

interface CaseMetadata {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contentRevision: number;
}

interface TaskMetadata {
  id: string;
  projectId: string;
  caseId: string;
  name: string;
  status: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  completedAt: string;
  startedAt: string;
  dueDate: string;
  updatedAt: string;
  contentRevision: number;
  _cachedTimeSeconds?: number;
  _cachedPomodoroCount?: number;
}

const TASK_CACHE_KEY = "task_data_v2";
const TASK_CACHE_TTL = 300;

function getAllTaskData(): {
  projects: ProjectMetadata[];
  cases: CaseMetadata[];
  tasks: TaskMetadata[];
} {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(TASK_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as {
        projects: ProjectMetadata[];
        cases: CaseMetadata[];
        tasks: TaskMetadata[];
      };
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Read projects
  const projSheet = ss.getSheetByName("Projects")!;
  const projLastRow = projSheet.getLastRow();
  let projects: ProjectMetadata[] = [];
  if (projLastRow > 1) {
    const projData = projSheet.getRange(2, 1, projLastRow - 1, 10).getValues();
    projects = projData
      .map((row) => ({
        id: String(row[0]),
        name: String(row[1]),
        color: String(row[3]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
        contentRevision: Math.max(1, Number(row[8]) || 1),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read cases
  const casesSheet = ss.getSheetByName("Cases")!;
  const casesLastRow = casesSheet.getLastRow();
  let cases: CaseMetadata[] = [];
  if (casesLastRow > 1) {
    const casesData = casesSheet.getRange(2, 1, casesLastRow - 1, 10).getValues();
    cases = casesData
      .map((row) => ({
        id: String(row[0]),
        projectId: String(row[1]),
        name: String(row[2]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
        contentRevision: Math.max(1, Number(row[8]) || 1),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read tasks
  const tasksSheet = ss.getSheetByName("Tasks")!;
  const tasksLastRow = tasksSheet.getLastRow();
  let tasks: TaskMetadata[] = [];
  if (tasksLastRow > 1) {
    const tasksData = tasksSheet.getRange(2, 1, tasksLastRow - 1, 15).getValues();
    tasks = tasksData
      .map((row) => ({
        id: String(row[0]),
        projectId: String(row[1]),
        caseId: String(row[2]),
        name: String(row[3]),
        status: String(row[5]),
        sortOrder: Number(row[6]),
        isActive: Boolean(row[7]),
        createdAt: String(row[8]),
        completedAt: String(row[9]),
        startedAt: String(row[10]),
        dueDate: String(row[11]),
        updatedAt: String(row[12]),
        contentRevision: Math.max(1, Number(row[13]) || 1),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Aggregate _cachedTimeSeconds from PomodoroLog column P (taskId)
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = logSheet.getLastRow();
  if (logLastRow > 1) {
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

  const result = { projects, cases, tasks };
  try {
    cache.put(TASK_CACHE_KEY, JSON.stringify(result), TASK_CACHE_TTL);
  } catch (_e) {
    // Cache too large, skip
  }
  return result;
}

function getProjectContent(
  id: string,
): { id: string; content: string; updatedAt: string; contentRevision: number } | null {
  return withContentMutationLock(() => getTaskEntityContentUnlocked("Projects", 3, 8, 9, id));
}

function getCaseContent(
  id: string,
): { id: string; content: string; updatedAt: string; contentRevision: number } | null {
  return withContentMutationLock(() => getTaskEntityContentUnlocked("Cases", 4, 8, 9, id));
}

function getTaskContent(
  id: string,
): { id: string; content: string; updatedAt: string; contentRevision: number } | null {
  return withContentMutationLock(() => getTaskEntityContentUnlocked("Tasks", 5, 13, 14, id));
}

function getTaskEntityContentUnlocked(
  sheetName: string,
  contentColumn: number,
  updatedAtColumn: number,
  revisionColumn: number,
  id: string,
): { id: string; content: string; updatedAt: string; contentRevision: number } | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const width = Math.max(contentColumn, updatedAtColumn, revisionColumn);
  const data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      return {
        id,
        content: String(data[i][contentColumn - 1]),
        updatedAt: String(data[i][updatedAtColumn - 1]),
        contentRevision: Math.max(1, Number(data[i][revisionColumn - 1]) || 1),
      };
    }
  }
  return null;
}

function saveProjectContent(
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
): ContentSaveResult {
  return saveTaskEntityContent("Projects", 3, 8, 9, 10, 6, id, content, baseRevision, mutationId);
}

function saveCaseContent(
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
): ContentSaveResult {
  return saveTaskEntityContent("Cases", 4, 8, 9, 10, 6, id, content, baseRevision, mutationId);
}

function saveTaskContent(
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
): ContentSaveResult {
  return saveTaskEntityContent("Tasks", 5, 13, 14, 15, 8, id, content, baseRevision, mutationId);
}

function saveTaskEntityContent(
  sheetName: string,
  contentColumn: number,
  updatedAtColumn: number,
  revisionColumn: number,
  mutationColumn: number,
  isActiveColumn: number,
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
): ContentSaveResult {
  const result = saveRevisionedContent(
    {
      sheetName,
      idColumn: 1,
      contentColumn,
      updatedAtColumn,
      revisionColumn,
      mutationColumn,
      isActiveColumn,
    },
    id,
    content,
    baseRevision,
    mutationId,
  );
  if (result.status === "saved") invalidateTaskCache();
  return result;
}

function addProject(
  id: string,
  name: string,
  color: string,
): { success: boolean; id: string; updatedAt: string } {
  const result = createEntityRowOnce(
    { sheetName: "Projects", idColumn: 1, updatedAtColumn: 8 },
    id,
    (updatedAt, sortOrder) => [id, name, "", color, sortOrder, true, updatedAt, updatedAt, 1, ""],
  );
  invalidateTaskCache();
  return { success: true, id: result.id, updatedAt: result.updatedAt };
}

function addCase(
  id: string,
  projectId: string,
  name: string,
): { success: boolean; id: string; updatedAt: string } {
  const result = createEntityRowOnce(
    { sheetName: "Cases", idColumn: 1, updatedAtColumn: 8 },
    id,
    (updatedAt, sortOrder) => [
      id,
      projectId,
      name,
      "",
      sortOrder,
      true,
      updatedAt,
      updatedAt,
      1,
      "",
    ],
  );
  invalidateTaskCache();
  return { success: true, id: result.id, updatedAt: result.updatedAt };
}

function addTask(
  id: string,
  projectId: string,
  caseId: string,
  name: string,
): { success: boolean; id: string; updatedAt: string } {
  const result = createEntityRowOnce(
    { sheetName: "Tasks", idColumn: 1, updatedAtColumn: 13 },
    id,
    (updatedAt, sortOrder) => [
      id,
      projectId,
      caseId || "",
      name,
      "",
      "todo",
      sortOrder,
      true,
      updatedAt,
      "",
      "",
      "",
      updatedAt,
      1,
      "",
    ],
  );
  invalidateTaskCache();
  return { success: true, id: result.id, updatedAt: result.updatedAt };
}

function updateProject(
  id: string,
  fields: { name?: string; color?: string },
): { success: boolean; updatedAt?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Projects")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 2).setValue(fields.name);
      if (fields.color !== undefined) sheet.getRange(row, 4).setValue(fields.color);
      const updatedAt = new Date().toISOString();
      sheet.getRange(row, 8).setValue(updatedAt);
      invalidateTaskCache();
      return { success: true, updatedAt };
    }
  }
  return { success: false };
}

function updateCase(
  id: string,
  fields: { name?: string; isActive?: boolean },
): { success: boolean; updatedAt?: string } {
  if (fields.isActive !== undefined) {
    return withContentMutationLock(() => updateCaseUnlocked(id, fields));
  }
  return updateCaseUnlocked(id, fields);
}

function updateCaseUnlocked(
  id: string,
  fields: { name?: string; isActive?: boolean },
): { success: boolean; updatedAt?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cases")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 3).setValue(fields.name);
      if (fields.isActive !== undefined) sheet.getRange(row, 6).setValue(fields.isActive);
      const updatedAt = new Date().toISOString();
      sheet.getRange(row, 8).setValue(updatedAt);
      invalidateTaskCache();
      return { success: true, updatedAt };
    }
  }
  return { success: false };
}

function updateTask(
  id: string,
  fields: {
    name?: string;
    status?: string;
    startedAt?: string;
    dueDate?: string;
    isActive?: boolean;
  },
): { success: boolean; updatedAt?: string } {
  if (fields.isActive !== undefined) {
    return withContentMutationLock(() => updateTaskUnlocked(id, fields));
  }
  return updateTaskUnlocked(id, fields);
}

function updateTaskUnlocked(
  id: string,
  fields: {
    name?: string;
    status?: string;
    startedAt?: string;
    dueDate?: string;
    isActive?: boolean;
  },
): { success: boolean; updatedAt?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tasks")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 4).setValue(fields.name);
      if (fields.status !== undefined) {
        const oldStatus = String(data[i][5]);
        sheet.getRange(row, 6).setValue(fields.status);
        if (fields.status === "done" && oldStatus !== "done") {
          sheet.getRange(row, 10).setValue(new Date().toISOString());
        } else if (fields.status !== "done" && oldStatus === "done") {
          sheet.getRange(row, 10).setValue("");
        }
      }
      if (fields.isActive !== undefined) sheet.getRange(row, 8).setValue(fields.isActive);
      if (fields.startedAt !== undefined) sheet.getRange(row, 11).setValue(fields.startedAt);
      if (fields.dueDate !== undefined) sheet.getRange(row, 12).setValue(fields.dueDate);
      const updatedAt = new Date().toISOString();
      sheet.getRange(row, 13).setValue(updatedAt);
      invalidateTaskCache();
      return { success: true, updatedAt };
    }
  }
  return { success: false };
}

function archiveProject(id: string): { success: boolean } {
  return withContentMutationLock(() => archiveTaskEntityUnlocked("Projects", 6, id));
}

function archiveCase(id: string): { success: boolean } {
  return withContentMutationLock(() => archiveTaskEntityUnlocked("Cases", 6, id));
}

function archiveTask(id: string): { success: boolean } {
  return withContentMutationLock(() => archiveTaskEntityUnlocked("Tasks", 8, id));
}

function archiveTaskEntityUnlocked(
  sheetName: string,
  isActiveColumn: number,
  id: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      sheet.getRange(i + 2, isActiveColumn).setValue(false);
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function reorderProjects(orderedIds: string[]): { success: boolean } {
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
  invalidateTaskCache();
  return { success: true };
}

function reorderCases(_projectId: string, orderedIds: string[]): { success: boolean } {
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
  invalidateTaskCache();
  return { success: true };
}

function reorderTasks(_parentId: string, orderedIds: string[]): { success: boolean } {
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
  invalidateTaskCache();
  return { success: true };
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

function invalidateTaskCache(): void {
  CacheService.getScriptCache().remove(TASK_CACHE_KEY);
}
