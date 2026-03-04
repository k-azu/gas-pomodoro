export interface PomodoroRecord {
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
  taskId?: string;
  projectId?: string;
  caseId?: string;
}

export interface InterruptionRecord {
  id: string;
  pomodoroId: string;
  type: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  category: string;
  note: string;
}

export interface TodayStats {
  completedPomodoros: number;
  abandonedPomodoros: number;
  totalWorkSeconds: number;
  totalBreakSeconds: number;
  totalWorkInterruptionSeconds: number;
  totalNonWorkInterruptionSeconds: number;
}
