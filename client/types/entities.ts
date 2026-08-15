export interface BaseEntity {
  id: string;
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

export interface Project extends BaseEntity {
  color: string;
}

export interface Case extends BaseEntity {
  projectId: string;
}

export type TaskStatus = "docs" | "doing" | "review" | "todo" | "pending" | "done";

export interface Task extends BaseEntity {
  projectId: string;
  caseId: string;
  status: TaskStatus;
  completedAt: string;
  startedAt: string;
  dueDate: string;
  _cachedTimeSeconds?: number;
  _cachedPomodoroCount?: number;
}

export interface Memo extends BaseEntity {
  tags: string[];
}

export type EntityType = "project" | "case" | "task" | "memo";
