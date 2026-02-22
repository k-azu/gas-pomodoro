interface ProjectMetadata {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _cachedTimeSeconds?: number;
}

interface CaseMetadata {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _cachedTimeSeconds?: number;
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
  _cachedTimeSeconds?: number;
}

const TASK_CACHE_KEY = "task_data_v1";
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
    const projData = projSheet.getRange(2, 1, projLastRow - 1, 8).getValues();
    projects = projData
      .filter((row) => row[5] === true)
      .map((row) => ({
        id: String(row[0]),
        name: String(row[1]),
        color: String(row[3]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read cases
  const casesSheet = ss.getSheetByName("Cases")!;
  const casesLastRow = casesSheet.getLastRow();
  let cases: CaseMetadata[] = [];
  if (casesLastRow > 1) {
    const casesData = casesSheet
      .getRange(2, 1, casesLastRow - 1, 8)
      .getValues();
    cases = casesData
      .filter((row) => row[5] === true)
      .map((row) => ({
        id: String(row[0]),
        projectId: String(row[1]),
        name: String(row[2]),
        sortOrder: Number(row[4]),
        isActive: Boolean(row[5]),
        createdAt: String(row[6]),
        updatedAt: String(row[7]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Read tasks
  const tasksSheet = ss.getSheetByName("Tasks")!;
  const tasksLastRow = tasksSheet.getLastRow();
  let tasks: TaskMetadata[] = [];
  if (tasksLastRow > 1) {
    const tasksData = tasksSheet
      .getRange(2, 1, tasksLastRow - 1, 13)
      .getValues();
    tasks = tasksData
      .filter((row) => row[7] === true)
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
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Aggregate _cachedTimeSeconds from PomodoroLog column P (taskId)
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = logSheet.getLastRow();
  if (logLastRow > 1) {
    // Read taskId (col 16) and actualDurationSeconds (col 6)
    const logData = logSheet.getRange(2, 1, logLastRow - 1, 16).getValues();
    const timeByTaskId: { [taskId: string]: number } = {};
    logData.forEach((row) => {
      const taskId = String(row[15]);
      if (!taskId) return;
      const type = String(row[6]);
      if (type !== "work") return;
      const actualSeconds = Number(row[5]);
      timeByTaskId[taskId] = (timeByTaskId[taskId] || 0) + actualSeconds;
    });

    // Assign to tasks
    tasks.forEach((t) => {
      if (timeByTaskId[t.id]) t._cachedTimeSeconds = timeByTaskId[t.id];
    });

    // Aggregate to cases and projects
    const timeByCaseId: { [caseId: string]: number } = {};
    const timeByProjectId: { [projectId: string]: number } = {};
    tasks.forEach((t) => {
      const secs = t._cachedTimeSeconds || 0;
      if (secs > 0) {
        if (t.caseId) {
          timeByCaseId[t.caseId] = (timeByCaseId[t.caseId] || 0) + secs;
        }
        timeByProjectId[t.projectId] =
          (timeByProjectId[t.projectId] || 0) + secs;
      }
    });
    cases.forEach((c) => {
      if (timeByCaseId[c.id]) c._cachedTimeSeconds = timeByCaseId[c.id];
    });
    projects.forEach((p) => {
      if (timeByProjectId[p.id]) p._cachedTimeSeconds = timeByProjectId[p.id];
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
): { id: string; content: string; updatedAt: string } | null {
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

function getCaseContent(
  id: string,
): { id: string; content: string; updatedAt: string } | null {
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

function getTaskContent(
  id: string,
): { id: string; content: string; updatedAt: string } | null {
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
): { success: boolean; id: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Projects")!;
  const now = new Date().toISOString();
  const lastRow = sheet.getLastRow();
  const nextOrder = lastRow;
  sheet.appendRow([id, name, "", color, nextOrder, true, now, now]);
  invalidateTaskCache();
  return { success: true, id };
}

function addCase(
  id: string,
  projectId: string,
  name: string,
): { success: boolean; id: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cases")!;
  const now = new Date().toISOString();
  const lastRow = sheet.getLastRow();
  const nextOrder = lastRow;
  sheet.appendRow([id, projectId, name, "", nextOrder, true, now, now]);
  invalidateTaskCache();
  return { success: true, id };
}

function addTask(
  id: string,
  projectId: string,
  caseId: string,
  name: string,
): { success: boolean; id: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tasks")!;
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
  ]);
  invalidateTaskCache();
  return { success: true, id };
}

function updateProject(
  id: string,
  fields: { name?: string; color?: string; content?: string },
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Projects")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 2).setValue(fields.name);
      if (fields.content !== undefined)
        sheet.getRange(row, 3).setValue(fields.content);
      if (fields.color !== undefined)
        sheet.getRange(row, 4).setValue(fields.color);
      sheet.getRange(row, 8).setValue(new Date().toISOString());
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function updateCase(
  id: string,
  fields: { name?: string; content?: string },
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cases")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 3).setValue(fields.name);
      if (fields.content !== undefined)
        sheet.getRange(row, 4).setValue(fields.content);
      sheet.getRange(row, 8).setValue(new Date().toISOString());
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function updateTask(
  id: string,
  fields: {
    name?: string;
    content?: string;
    status?: string;
    startedAt?: string;
    dueDate?: string;
  },
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tasks")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === id) {
      const row = i + 2;
      if (fields.name !== undefined) sheet.getRange(row, 4).setValue(fields.name);
      if (fields.content !== undefined)
        sheet.getRange(row, 5).setValue(fields.content);
      if (fields.status !== undefined) {
        const oldStatus = String(data[i][5]);
        sheet.getRange(row, 6).setValue(fields.status);
        if (fields.status === "done" && oldStatus !== "done") {
          sheet.getRange(row, 10).setValue(new Date().toISOString());
        } else if (fields.status !== "done" && oldStatus === "done") {
          sheet.getRange(row, 10).setValue("");
        }
      }
      if (fields.startedAt !== undefined)
        sheet.getRange(row, 11).setValue(fields.startedAt);
      if (fields.dueDate !== undefined)
        sheet.getRange(row, 12).setValue(fields.dueDate);
      sheet.getRange(row, 13).setValue(new Date().toISOString());
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function archiveProject(id: string): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Projects")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      sheet.getRange(i + 2, 6).setValue(false);
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function archiveCase(id: string): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cases")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      sheet.getRange(i + 2, 6).setValue(false);
      invalidateTaskCache();
      return { success: true };
    }
  }
  return { success: false };
}

function archiveTask(id: string): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tasks")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      sheet.getRange(i + 2, 8).setValue(false);
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

function reorderCases(
  _projectId: string,
  orderedIds: string[],
): { success: boolean } {
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

function reorderTasks(
  _parentId: string,
  orderedIds: string[],
): { success: boolean } {
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

  const data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  return data
    .filter((row) => String(row[15]) === taskId)
    .map((row) => ({
      id: String(row[0]),
      date: String(row[1]),
      startTime: String(row[2]),
      endTime: String(row[3]),
      durationSeconds: Number(row[4]),
      actualDurationSeconds: Number(row[5]),
      type: String(row[6]),
      description: String(row[7]),
      category: String(row[8]),
      workInterruptions: Number(row[9]),
      nonWorkInterruptions: Number(row[10]),
      workInterruptionSeconds: Number(row[11]),
      nonWorkInterruptionSeconds: Number(row[12]),
      completionStatus: String(row[13]),
      pomodoroSetIndex: Number(row[14]),
      taskId: String(row[15]),
    }))
    .reverse();
}

function invalidateTaskCache(): void {
  CacheService.getScriptCache().remove(TASK_CACHE_KEY);
}
