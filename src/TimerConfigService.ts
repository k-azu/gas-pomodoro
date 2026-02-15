interface TimerConfig {
  patternName: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosBeforeLongBreak: number;
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
  }));

  cache.put(TIMER_CONFIGS_CACHE_KEY, JSON.stringify(result), TIMER_CONFIG_CACHE_TTL);
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
