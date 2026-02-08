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
  const sheet = ss.getSheetByName('PomodoroLog')!;
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
    record.pomodoroSetIndex
  ]);
  return { success: true };
}

function saveInterruptions(interruptions: InterruptionRecord[]): { success: boolean } {
  if (interruptions.length === 0) return { success: true };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Interruptions')!;
  const rows = interruptions.map((r) => [
    r.id, r.pomodoroId, r.type, r.startTime, r.endTime,
    r.durationSeconds, r.category, r.note
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  return { success: true };
}

function getRecentRecords(limit: number = 10): PomodoroRecord[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PomodoroLog')!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const TAIL_ROWS = 100;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 15).getValues();

  return data.map((row) => ({
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
    pomodoroSetIndex: Number(row[14])
  })).reverse();
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
  const sheet = ss.getSheetByName('PomodoroLog')!;
  const lastRow = sheet.getLastRow();

  const stats: TodayStats = {
    completedPomodoros: 0,
    abandonedPomodoros: 0,
    totalWorkSeconds: 0,
    totalBreakSeconds: 0,
    totalWorkInterruptionSeconds: 0,
    totalNonWorkInterruptionSeconds: 0
  };

  if (lastRow <= 1) return stats;

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const TAIL_ROWS = 100;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 15).getValues();

  data.forEach((row) => {
    const dateVal = row[1];
    const dateStr = dateVal instanceof Date
      ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(dateVal);
    if (dateStr !== today) return;

    const type = String(row[6]);
    const status = String(row[13]);
    const actualSeconds = Number(row[5]);
    const workIntSeconds = Number(row[11]);
    const nonWorkIntSeconds = Number(row[12]);

    if (type === 'work') {
      if (status === 'completed') {
        stats.completedPomodoros++;
      } else if (status === 'abandoned') {
        stats.abandonedPomodoros++;
      }
      // Work time = actual duration minus ALL interruptions (pure focus)
      stats.totalWorkSeconds += actualSeconds - workIntSeconds - nonWorkIntSeconds;
      stats.totalWorkInterruptionSeconds += workIntSeconds;
      stats.totalNonWorkInterruptionSeconds += nonWorkIntSeconds;
    } else if (type === 'shortBreak' || type === 'longBreak') {
      stats.totalBreakSeconds += actualSeconds;
    }
  });

  return stats;
}

function getTodayInterruptions(): InterruptionRecord[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Interruptions')!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const TAIL_ROWS = 200;
  const startRow = Math.max(2, lastRow - TAIL_ROWS + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 8).getValues();

  return data
    .filter((row) => {
      const startTime = String(row[3]);
      return startTime.indexOf(today) === 0;
    })
    .map((row) => ({
      id: String(row[0]),
      pomodoroId: String(row[1]),
      type: String(row[2]),
      startTime: String(row[3]),
      endTime: String(row[4]),
      durationSeconds: Number(row[5]),
      category: String(row[6]),
      note: String(row[7])
    }));
}
