interface PomodoroRecord {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  actualDurationSeconds: number;
  type: string;
  description: string;
  category: string;
  workInterruptions: number;
  nonWorkInterruptions: number;
  workInterruptionSeconds: number;
  nonWorkInterruptionSeconds: number;
  completionStatus: string;
  pomodoroSetIndex: number;
}

interface InterruptionRecord {
  id: string;
  pomodoroId: string;
  type: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  category: string;
  note: string;
}

function saveRecord(record: PomodoroRecord): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  sheet.appendRow([
    record.id,
    record.date,
    record.startTime,
    record.endTime,
    record.durationSeconds,
    record.actualDurationSeconds,
    record.type,
    record.description,
    record.category,
    record.workInterruptions,
    record.nonWorkInterruptions,
    record.workInterruptionSeconds,
    record.nonWorkInterruptionSeconds,
    record.completionStatus,
    record.pomodoroSetIndex,
  ]);
  return { success: true };
}

function saveInterruptions(interruptions: InterruptionRecord[]): {
  success: boolean;
} {
  if (interruptions.length === 0) return { success: true };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const rows = interruptions.map((r) => [
    r.id,
    r.pomodoroId,
    r.type,
    r.startTime,
    r.endTime,
    r.durationSeconds,
    r.category,
    r.note,
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  return { success: true };
}

function updateRecordDescription(
  recordId: string,
  description: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === recordId) {
      sheet.getRange(i + 2, 8).setValue(description); // column 8 = description
      return { success: true };
    }
  }
  return { success: false };
}

function updateInterruptionNote(
  interruptionId: string,
  note: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === interruptionId) {
      sheet.getRange(i + 2, 8).setValue(note); // column 8 = note
      return { success: true };
    }
  }
  return { success: false };
}

function updateRecordCategory(
  recordId: string,
  category: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === recordId) {
      sheet.getRange(i + 2, 9).setValue(category); // column 9 = category
      return { success: true };
    }
  }
  return { success: false };
}

function updateInterruptionCategory(
  interruptionId: string,
  category: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === interruptionId) {
      sheet.getRange(i + 2, 7).setValue(category); // column 7 = category
      return { success: true };
    }
  }
  return { success: false };
}

function updateInterruptionType(
  interruptionId: string,
  type: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === interruptionId) {
      sheet.getRange(i + 2, 3).setValue(type); // column 3 = type
      return { success: true };
    }
  }
  return { success: false };
}

function updateInterruptionTimes(
  interruptionId: string,
  startTimeISO: string | null,
  endTimeISO: string | null,
): { success: boolean } {
  if (!startTimeISO && !endTimeISO) return { success: false };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === interruptionId) {
      const row = i + 2;
      if (startTimeISO) sheet.getRange(row, 4).setValue(startTimeISO); // column 4 = startTime
      if (endTimeISO) sheet.getRange(row, 5).setValue(endTimeISO); // column 5 = endTime
      const start = new Date(
        startTimeISO || String(sheet.getRange(row, 4).getValue()),
      );
      const end = new Date(
        endTimeISO || String(sheet.getRange(row, 5).getValue()),
      );
      const durationSeconds = Math.round(
        (end.getTime() - start.getTime()) / 1000,
      );
      sheet.getRange(row, 6).setValue(durationSeconds); // column 6 = durationSeconds
      return { success: true };
    }
  }
  return { success: false };
}

function updateRecordTimes(
  recordId: string,
  startTimeISO: string | null,
  endTimeISO: string | null,
): { success: boolean } {
  if (!startTimeISO && !endTimeISO) return { success: false };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === recordId) {
      const row = i + 2;
      if (startTimeISO) sheet.getRange(row, 3).setValue(startTimeISO);
      if (endTimeISO) sheet.getRange(row, 4).setValue(endTimeISO);
      const start = new Date(
        startTimeISO || String(sheet.getRange(row, 3).getValue()),
      );
      const end = new Date(
        endTimeISO || String(sheet.getRange(row, 4).getValue()),
      );
      const actualSeconds = Math.round(
        (end.getTime() - start.getTime()) / 1000,
      );
      sheet.getRange(row, 6).setValue(actualSeconds);
      return { success: true };
    }
  }
  return { success: false };
}

function getRecentRecords(limit: number = 10): PomodoroRecord[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const TAIL_ROWS = 100;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 15).getValues();

  return data
    .filter((row) => {
      const raw = row[1];
      const dateStr =
        raw instanceof Date
          ? Utilities.formatDate(raw, Session.getScriptTimeZone(), "yyyy-MM-dd")
          : String(raw);
      return dateStr === today;
    })
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
    }))
    .reverse();
}

interface TodayStats {
  completedPomodoros: number;
  abandonedPomodoros: number;
  totalWorkSeconds: number;
  totalBreakSeconds: number;
  totalWorkInterruptionSeconds: number;
  totalNonWorkInterruptionSeconds: number;
}

function getTodayStats(): TodayStats {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();

  const stats: TodayStats = {
    completedPomodoros: 0,
    abandonedPomodoros: 0,
    totalWorkSeconds: 0,
    totalBreakSeconds: 0,
    totalWorkInterruptionSeconds: 0,
    totalNonWorkInterruptionSeconds: 0,
  };

  if (lastRow <= 1) return stats;

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const TAIL_ROWS = 100;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 15).getValues();

  data.forEach((row) => {
    const dateVal = row[1];
    const dateStr =
      dateVal instanceof Date
        ? Utilities.formatDate(
            dateVal,
            Session.getScriptTimeZone(),
            "yyyy-MM-dd",
          )
        : String(dateVal);
    if (dateStr !== today) return;

    const type = String(row[6]);
    const status = String(row[13]);
    const actualSeconds = Number(row[5]);
    const workIntSeconds = Number(row[11]);
    const nonWorkIntSeconds = Number(row[12]);

    if (type === "work") {
      if (status === "completed") {
        stats.completedPomodoros++;
      } else if (status === "abandoned") {
        stats.abandonedPomodoros++;
      }
      // Work time = actual duration minus ALL interruptions (pure focus)
      stats.totalWorkSeconds +=
        actualSeconds - workIntSeconds - nonWorkIntSeconds;
      stats.totalWorkInterruptionSeconds += workIntSeconds;
      stats.totalNonWorkInterruptionSeconds += nonWorkIntSeconds;
    } else if (type === "shortBreak" || type === "longBreak") {
      stats.totalBreakSeconds += actualSeconds;
    }
  });

  return stats;
}

function getRefreshData(): {
  todayStats: TodayStats;
  recentRecords: PomodoroRecord[];
  todayInterruptions: InterruptionRecord[];
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  // --- PomodoroLog: read once for stats + records ---
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = logSheet.getLastRow();
  const stats: TodayStats = {
    completedPomodoros: 0,
    abandonedPomodoros: 0,
    totalWorkSeconds: 0,
    totalBreakSeconds: 0,
    totalWorkInterruptionSeconds: 0,
    totalNonWorkInterruptionSeconds: 0,
  };
  let recentRecords: PomodoroRecord[] = [];

  if (logLastRow > 1) {
    const TAIL_ROWS = 100;
    const startRow = Math.max(2, logLastRow - TAIL_ROWS + 1);
    const numRows = logLastRow - startRow + 1;
    const logData = logSheet.getRange(startRow, 1, numRows, 15).getValues();

    const todayRows: PomodoroRecord[] = [];
    logData.forEach((row) => {
      const dateVal = row[1];
      const dateStr =
        dateVal instanceof Date
          ? Utilities.formatDate(dateVal, tz, "yyyy-MM-dd")
          : String(dateVal);
      if (dateStr !== today) return;

      const type = String(row[6]);
      const status = String(row[13]);
      const actualSeconds = Number(row[5]);
      const workIntSeconds = Number(row[11]);
      const nonWorkIntSeconds = Number(row[12]);

      if (type === "work") {
        if (status === "completed") stats.completedPomodoros++;
        else if (status === "abandoned") stats.abandonedPomodoros++;
        stats.totalWorkSeconds +=
          actualSeconds - workIntSeconds - nonWorkIntSeconds;
        stats.totalWorkInterruptionSeconds += workIntSeconds;
        stats.totalNonWorkInterruptionSeconds += nonWorkIntSeconds;
      } else if (type === "shortBreak" || type === "longBreak") {
        stats.totalBreakSeconds += actualSeconds;
      }

      todayRows.push({
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
      });
    });
    recentRecords = todayRows.reverse();
  }

  // --- Interruptions ---
  const intSheet = ss.getSheetByName("Interruptions")!;
  const intLastRow = intSheet.getLastRow();
  let todayInterruptions: InterruptionRecord[] = [];
  if (intLastRow > 1) {
    const INT_TAIL = 200;
    const intStartRow = Math.max(2, intLastRow - INT_TAIL + 1);
    const intNumRows = intLastRow - intStartRow + 1;
    const intData = intSheet
      .getRange(intStartRow, 1, intNumRows, 8)
      .getValues();
    todayInterruptions = intData
      .filter((row) => {
        const raw = row[3];
        const d = raw instanceof Date ? raw : new Date(String(raw));
        const dateStr = Utilities.formatDate(d, tz, "yyyy-MM-dd");
        return dateStr === today;
      })
      .map((row) => ({
        id: String(row[0]),
        pomodoroId: String(row[1]),
        type: String(row[2]),
        startTime: String(row[3]),
        endTime: String(row[4]),
        durationSeconds: Number(row[5]),
        category: String(row[6]),
        note: String(row[7]),
      }));
  }

  return {
    todayStats: stats,
    recentRecords,
    todayInterruptions,
  };
}

function getDataForDate(dateStr: string): {
  todayStats: TodayStats;
  recentRecords: PomodoroRecord[];
  todayInterruptions: InterruptionRecord[];
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();

  // --- PomodoroLog: full scan for past dates ---
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = logSheet.getLastRow();
  const stats: TodayStats = {
    completedPomodoros: 0,
    abandonedPomodoros: 0,
    totalWorkSeconds: 0,
    totalBreakSeconds: 0,
    totalWorkInterruptionSeconds: 0,
    totalNonWorkInterruptionSeconds: 0,
  };
  let recentRecords: PomodoroRecord[] = [];

  if (logLastRow > 1) {
    const logData = logSheet.getRange(2, 1, logLastRow - 1, 15).getValues();
    const dateRows: PomodoroRecord[] = [];

    logData.forEach((row) => {
      const dateVal = row[1];
      const rowDateStr =
        dateVal instanceof Date
          ? Utilities.formatDate(dateVal, tz, "yyyy-MM-dd")
          : String(dateVal);
      if (rowDateStr !== dateStr) return;

      const type = String(row[6]);
      const status = String(row[13]);
      const actualSeconds = Number(row[5]);
      const workIntSeconds = Number(row[11]);
      const nonWorkIntSeconds = Number(row[12]);

      if (type === "work") {
        if (status === "completed") stats.completedPomodoros++;
        else if (status === "abandoned") stats.abandonedPomodoros++;
        stats.totalWorkSeconds +=
          actualSeconds - workIntSeconds - nonWorkIntSeconds;
        stats.totalWorkInterruptionSeconds += workIntSeconds;
        stats.totalNonWorkInterruptionSeconds += nonWorkIntSeconds;
      } else if (type === "shortBreak" || type === "longBreak") {
        stats.totalBreakSeconds += actualSeconds;
      }

      dateRows.push({
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
      });
    });
    recentRecords = dateRows.reverse();
  }

  // --- Interruptions: full scan ---
  const intSheet = ss.getSheetByName("Interruptions")!;
  const intLastRow = intSheet.getLastRow();
  let dateInterruptions: InterruptionRecord[] = [];
  if (intLastRow > 1) {
    const intData = intSheet.getRange(2, 1, intLastRow - 1, 8).getValues();
    dateInterruptions = intData
      .filter((row) => {
        const raw = row[3];
        const d = raw instanceof Date ? raw : new Date(String(raw));
        const rowDateStr = Utilities.formatDate(d, tz, "yyyy-MM-dd");
        return rowDateStr === dateStr;
      })
      .map((row) => ({
        id: String(row[0]),
        pomodoroId: String(row[1]),
        type: String(row[2]),
        startTime: String(row[3]),
        endTime: String(row[4]),
        durationSeconds: Number(row[5]),
        category: String(row[6]),
        note: String(row[7]),
      }));
  }

  return {
    todayStats: stats,
    recentRecords,
    todayInterruptions: dateInterruptions,
  };
}

function getWeekRecordCounts(weekStartDate: string): {
  [dateStr: string]: number;
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const logSheet = ss.getSheetByName("PomodoroLog")!;
  const logLastRow = logSheet.getLastRow();

  // Build set of 7 dates
  const startDate = new Date(weekStartDate + "T00:00:00");
  const dateCounts: { [dateStr: string]: number } = {};
  const dateSet = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    const ds = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    dateCounts[ds] = 0;
    dateSet.add(ds);
  }

  if (logLastRow <= 1) return dateCounts;

  const logData = logSheet.getRange(2, 1, logLastRow - 1, 15).getValues();
  logData.forEach((row) => {
    const type = String(row[6]);
    if (type !== "work") return;

    const dateVal = row[1];
    const rowDateStr =
      dateVal instanceof Date
        ? Utilities.formatDate(dateVal, tz, "yyyy-MM-dd")
        : String(dateVal);
    if (dateSet.has(rowDateStr)) {
      dateCounts[rowDateStr]++;
    }
  });

  return dateCounts;
}

function getLastWorkRecord(): {
  description: string;
  category: string;
} | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PomodoroLog")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const SCAN = 50;
  const start = Math.max(2, lastRow - SCAN + 1);
  const data = sheet.getRange(start, 1, lastRow - start + 1, 15).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][6]) === "work") {
      return {
        description: String(data[i][7]),
        category: String(data[i][8]),
      };
    }
  }
  return null;
}

function getTodayInterruptions(): InterruptionRecord[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Interruptions")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const TAIL_ROWS = 200;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 8).getValues();

  return data
    .filter((row) => {
      const raw = row[3];
      const d = raw instanceof Date ? raw : new Date(String(raw));
      const dateStr = Utilities.formatDate(
        d,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd",
      );
      return dateStr === today;
    })
    .map((row) => ({
      id: String(row[0]),
      pomodoroId: String(row[1]),
      type: String(row[2]),
      startTime: String(row[3]),
      endTime: String(row[4]),
      durationSeconds: Number(row[5]),
      category: String(row[6]),
      note: String(row[7]),
    }));
}
