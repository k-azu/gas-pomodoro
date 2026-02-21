interface TimerConfig {
  patternName: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosBeforeLongBreak: number;
  isActive?: boolean;
}

const TIMER_CONFIGS_CACHE_KEY = "timer_configs_v1";
const TIMER_CONFIG_CACHE_TTL = 300; // 5 minutes

function getAllTimerConfigs(): TimerConfig[] {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(TIMER_CONFIGS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as TimerConfig[];
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [
      {
        patternName: "Standard",
        workMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        pomodorosBeforeLongBreak: 4,
        isActive: true,
      },
    ];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const result = data.map((row) => ({
    patternName: String(row[0]),
    workMinutes: Number(row[1]),
    shortBreakMinutes: Number(row[2]),
    longBreakMinutes: Number(row[3]),
    pomodorosBeforeLongBreak: Number(row[4]),
    isActive: row[5] === true,
  }));

  cache.put(
    TIMER_CONFIGS_CACHE_KEY,
    JSON.stringify(result),
    TIMER_CONFIG_CACHE_TTL,
  );
  return result;
}

function getTimerConfig(): TimerConfig {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();

  const defaultConfig: TimerConfig = {
    patternName: "Standard",
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    pomodorosBeforeLongBreak: 4,
  };

  if (lastRow <= 1) return defaultConfig;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const active = data.find((row) => row[5] === true);

  if (!active) return defaultConfig;

  return {
    patternName: String(active[0]),
    workMinutes: Number(active[1]),
    shortBreakMinutes: Number(active[2]),
    longBreakMinutes: Number(active[3]),
    pomodorosBeforeLongBreak: Number(active[4]),
  };
}

function addTimerConfig(
  name: string,
  work: number,
  shortBreak: number,
  longBreak: number,
  sets: number,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    if (existing.some((row) => String(row[0]) === name)) {
      return { success: false, message: "同名のパターンが存在します" };
    }
  }

  sheet.appendRow([name, work, shortBreak, longBreak, sets, false]);
  CacheService.getScriptCache().remove(TIMER_CONFIGS_CACHE_KEY);
  return { success: true };
}

function updateTimerConfig(
  originalName: string,
  name: string,
  work: number,
  shortBreak: number,
  longBreak: number,
  sets: number,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1)
    return { success: false, message: "パターンが見つかりません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  if (originalName !== name) {
    if (data.some((row) => String(row[0]) === name)) {
      return { success: false, message: "同名のパターンが存在します" };
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === originalName) {
      const isActive = data[i][5] === true;
      sheet
        .getRange(i + 2, 1, 1, 6)
        .setValues([[name, work, shortBreak, longBreak, sets, isActive]]);
      CacheService.getScriptCache().remove(TIMER_CONFIGS_CACHE_KEY);
      return { success: true };
    }
  }

  return { success: false, message: "パターンが見つかりません" };
}

function deleteTimerConfig(
  patternName: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2)
    return { success: false, message: "最後のパターンは削除できません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === patternName) {
      if (data[i][5] === true) {
        return {
          success: false,
          message: "アクティブなパターンは削除できません",
        };
      }
      sheet.deleteRow(i + 2);
      CacheService.getScriptCache().remove(TIMER_CONFIGS_CACHE_KEY);
      return { success: true };
    }
  }

  return { success: false, message: "パターンが見つかりません" };
}

function setActiveTimerConfig(
  patternName: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TimerConfig")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1)
    return { success: false, message: "パターンが見つかりません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const newValues: boolean[][] = [];
  let found = false;

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === patternName) {
      newValues.push([true]);
      found = true;
    } else {
      newValues.push([false]);
    }
  }

  if (!found)
    return { success: false, message: "パターンが見つかりません" };

  sheet.getRange(2, 6, lastRow - 1, 1).setValues(newValues);
  CacheService.getScriptCache().remove(TIMER_CONFIGS_CACHE_KEY);
  return { success: true };
}
