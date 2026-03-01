/** Internal fields used by EntityStore for sync tracking */
export interface EntityInternals {
  _dirty?: boolean;
  _pendingCreate?: boolean;
  _serverUpdatedAt?: string;
  _contentDirtyAt?: string | null;
}

export interface BaseEntity extends EntityInternals {
  id: string;
  name: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends BaseEntity {
  color: string;
}

export interface Case extends BaseEntity {
  projectId: string;
}

export type TaskStatus =
  | "docs"
  | "doing"
  | "review"
  | "todo"
  | "pending"
  | "done";

export interface Task extends BaseEntity {
  projectId: string;
  caseId: string;
  status: TaskStatus;
  completedAt: string;
  startedAt: string;
  dueDate: string;
}

export interface Memo extends BaseEntity {
  tags: string[];
}

export type EntityType = "project" | "case" | "task" | "memo";
