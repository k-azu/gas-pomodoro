function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  initializeSpreadsheet();
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Pomodoro Timer")
    .setFaviconUrl("https://drive.google.com/uc?id=1WaX5uI1Uxgt63EiOkIh1ZpiRmi77_w2h&.png") // ※ 任意
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function includeEditorBundle(): string {
  let result = "";
  for (let i = 1; i <= 10; i++) {
    try {
      result += HtmlService.createHtmlOutputFromFile(
        "EditorBundle" + i,
      ).getContent();
    } catch (_e) {
      break;
    }
  }
  if (result === "") {
    // Fallback: single file (small bundle)
    result = HtmlService.createHtmlOutputFromFile("EditorBundle").getContent();
  }
  return result;
}

function getSpreadsheetUrl(): string {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}

function getAllInitData(): {
  timerConfigs: TimerConfig[];
  categories: CategoryItem[];
  interruptionCategories: CategoryItem[];
  todayStats: TodayStats;
  recentRecords: PomodoroRecord[];
  spreadsheetUrl: string;
  todayInterruptions: InterruptionRecord[];
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  // --- TimerConfig ---
  const tcSheet = ss.getSheetByName("TimerConfig")!;
  const tcLastRow = tcSheet.getLastRow();
  let timerConfigs: TimerConfig[];
  if (tcLastRow <= 1) {
    timerConfigs = [
      {
        patternName: "Standard",
        workMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        pomodorosBeforeLongBreak: 4,
      },
    ];
  } else {
    const tcData = tcSheet.getRange(2, 1, tcLastRow - 1, 6).getValues();
    timerConfigs = tcData.map((row) => ({
      patternName: String(row[0]),
      workMinutes: Number(row[1]),
      shortBreakMinutes: Number(row[2]),
      longBreakMinutes: Number(row[3]),
      pomodorosBeforeLongBreak: Number(row[4]),
    }));
  }

  // --- Categories ---
  const catSheet = ss.getSheetByName("Categories")!;
  const catLastRow = catSheet.getLastRow();
  let categories: CategoryItem[] = [];
  if (catLastRow > 1) {
    const catData = catSheet.getRange(2, 1, catLastRow - 1, 4).getValues();
    categories = catData
      .filter((row) => row[3] === true)
      .map((row) => ({
        name: String(row[0]),
        color: String(row[1]),
        sortOrder: Number(row[2]),
        isActive: Boolean(row[3]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // --- InterruptionCategories ---
  const icSheet = ss.getSheetByName("InterruptionCategories")!;
  const icLastRow = icSheet.getLastRow();
  let interruptionCategories: CategoryItem[] = [];
  if (icLastRow > 1) {
    const icData = icSheet.getRange(2, 1, icLastRow - 1, 4).getValues();
    interruptionCategories = icData
      .filter((row) => row[3] === true)
      .map((row) => ({
        name: String(row[0]),
        color: String(row[1]),
        sortOrder: Number(row[2]),
        isActive: Boolean(row[3]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // --- PomodoroLog: read once, compute stats + recentRecords ---
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

      // Stats
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

      // Record
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
    timerConfigs,
    categories,
    interruptionCategories,
    todayStats: stats,
    recentRecords,
    spreadsheetUrl: ss.getUrl(),
    todayInterruptions,
  };
}
