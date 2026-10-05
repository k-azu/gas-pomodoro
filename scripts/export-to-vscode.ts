// Convert the folder written by exportForVscode() (src/ExportService.ts) into vscode-pomodoro records.
//
//   pnpm exec tsx scripts/export-to-vscode.ts --input <export folder> --workspace <record workspace> [--dry-run]
//
// Options: --projects-folder <name> (default "projects"), --activities-folder <name> (default
// "activities"), --assets <dir> (default "assets"), --skip-activities (projects, cases and tasks only),
// --type-map <json> (GAS category name -> existing activity type ID, or "new" to add the category).
// Categories used by records map to the workspace's activity types by name; the run stops and lists
// any category that neither matches nor appears in --type-map.
// Existing records are never overwritten; the run stops before writing if any target already exists.
// .pomodoro/activity-types.json is the one file updated in place, only for categories mapped to "new".

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

interface ExportedProject {
  id: string;
  name: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}
interface ExportedCase extends ExportedProject {
  projectId: string;
}
interface ExportedTask extends ExportedCase {
  caseId: string;
  status: string;
  completedAt: string;
  startedAt: string;
  dueDate: string;
}
interface ExportedRecord {
  id: string;
  startTime: string;
  endTime: string;
  type: string;
  content: string;
  category: string;
  pomodoroSetIndex: number;
  taskId: string;
  projectId: string;
  caseId: string;
}
interface ExportedInterruption {
  id: string;
  pomodoroId: string;
  type: string;
  startTime: string;
  endTime: string;
  category: string;
  content: string;
}
interface ExportedCategory {
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}
interface ActivityType {
  id: string;
  name: string;
  color: string;
  archived?: boolean;
  [key: string]: unknown;
}
interface ExportData {
  format: number;
  timeZone?: string;
  projects: ExportedProject[];
  cases: ExportedCase[];
  tasks: ExportedTask[];
  records?: ExportedRecord[];
  interruptions?: ExportedInterruption[];
  categories?: ExportedCategory[];
  interruptionCategories?: ExportedCategory[];
  images: { fileId: string; fileName: string }[];
  failedImages: { fileId: string; error: string }[];
  pendingImages: string[];
}
interface OutputDocument {
  file: string;
  data: Record<string, unknown>;
  body: string;
}

const statuses = ["todo", "doing", "review", "pending", "done", "docs"];
const phases = ["work", "shortBreak", "longBreak"];
// Same defaults as the extension's activity-types.json and pomodoro.default*Type settings.
const defaultActivityTypes: ActivityType[] = [
  { id: "activity-work", name: "作業", color: "blue" },
  { id: "activity-meeting", name: "会議", color: "purple" },
  { id: "activity-away", name: "休憩／離席", color: "green" },
];
const workTypeId = "activity-work";
const awayTypeId = "activity-away";
const driveUrlRe = /https:\/\/drive\.google\.com\/file\/d\/([^/\s)"'?#]+)\/view(?:\?[^\s)"'#]*)?/g;

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    workspace: { type: "string" },
    "projects-folder": { type: "string", default: "projects" },
    "activities-folder": { type: "string", default: "activities" },
    "skip-activities": { type: "boolean", default: false },
    "type-map": { type: "string" },
    assets: { type: "string", default: "assets" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.input || !values.workspace) {
  console.error(
    "使い方: tsx scripts/export-to-vscode.ts --input <書き出しフォルダ> --workspace <記録用ワークスペース> [--dry-run]",
  );
  process.exit(2);
}
const inputDir = path.resolve(values.input);
const workspace = path.resolve(values.workspace);
const projectsDir = path.join(workspace, values["projects-folder"]!);
const activitiesDir = path.join(workspace, values["activities-folder"]!);
const activityTypesFile = path.join(workspace, ".pomodoro", "activity-types.json");
const skipActivities = values["skip-activities"]!;
const assetsDir = values.assets!.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "");
const dryRun = values["dry-run"]!;
const warnings: string[] = [];

async function findFiles(dir: string, found = new Map<string, string>()) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await findFiles(full, found);
    else if (!found.has(entry.name)) found.set(entry.name, full);
  }
  return found;
}

const timestamp = (value: string) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};
const calendarDate = (value: string, label: string) => {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  warnings.push(`${label}: 日付として読めない値を省略しました（${value}）`);
  return undefined;
};
/** GAS records have no title; use the first text line, keeping the whole content as the body. */
function titleFrom(content: string) {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+|- \[[ xX]\]\s+)*/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (line) return line.length > 60 ? line.slice(0, 60) + "…" : line;
  }
  return undefined;
}
/** Nearest extension tag color for a GAS hex color. */
function tagColor(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "neutral";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max - min < 0.15) return "neutral";
  const d = max - min;
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const h = (hue + 360) % 360;
  if (h < 15 || h >= 330) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 260) return "blue";
  return "purple";
}
/** Sibling order follows the sheet order; gaps leave room for later moves in the extension. */
function rankBySortOrder<T extends { id: string; sortOrder: number }>(items: T[]) {
  const rank = (item: T) => (Number.isFinite(item.sortOrder) ? item.sortOrder : Infinity);
  const ranks = new Map<string, number>();
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .forEach(({ item }, index) => ranks.set(item.id, (index + 1) * 1024));
  return ranks;
}
// JSON strings, numbers and booleans are valid YAML scalars, so no YAML library is needed.
function serialize({ data, body }: OutputDocument) {
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  const text = body.replace(/\r\n?/g, "\n");
  return `---\n${lines.join("\n")}\n---\n${text && !text.endsWith("\n") ? text + "\n" : text}`;
}

const data = JSON.parse(await fs.readFile(path.join(inputDir, "data.json"), "utf8")) as ExportData;
if (data.format !== 1 && data.format !== 2)
  throw new Error(`未対応の書き出し形式です: ${data.format}`);
const safeId = /^[A-Za-z0-9_-]+$/;
const records = skipActivities ? [] : (data.records ?? []);
const interruptions = skipActivities ? [] : (data.interruptions ?? []);
if (!skipActivities && data.format < 2)
  warnings.push("書き出しに履歴が含まれていません。exportForVscode() を更新して再実行してください");
for (const doc of [...data.projects, ...data.cases, ...data.tasks, ...records, ...interruptions]) {
  if (!safeId.test(doc.id)) throw new Error(`ファイル名に使えないIDです: ${doc.id}`);
}

const inputFiles = await findFiles(inputDir);
const imageSources = new Map<string, { source: string; fileName: string }>();
for (const image of data.images) {
  const source = inputFiles.get(image.fileName);
  if (source) imageSources.set(image.fileId, { source, fileName: image.fileName });
}

const convertedTasks = new Map<string, string>(); // GAS task ID -> work item ID
const projectsById = new Map(data.projects.map((p) => [p.id, p]));
const casesById = new Map(data.cases.map((c) => [c.id, c]));
const projectRanks = rankBySortOrder(data.projects);
const caseRanks = rankBySortOrder(data.cases);
const taskRanks = rankBySortOrder(data.tasks);
const documents: OutputDocument[] = [];
const imageCopies = new Map<string, string>(); // destination -> source
const missingImages = new Set<string>();

/** Images go to an assets folder beside the document that references them. */
function convertBody(content: string, documentDir: string, label: string) {
  return content.replace(driveUrlRe, (url, fileId: string) => {
    const image = imageSources.get(fileId);
    if (!image) {
      missingImages.add(fileId);
      warnings.push(`${label}: 画像 ${fileId} がないためDriveのURLを残しました`);
      return url;
    }
    imageCopies.set(path.join(documentDir, ...assetsDir.split("/"), image.fileName), image.source);
    return `${assetsDir}/${image.fileName}`;
  });
}
const projectDir = (projectId: string) => path.join(projectsDir, `p-${projectId}`);
const fileFor = (projectId: string, name: string) => path.join(projectDir(projectId), name);

for (const project of data.projects) {
  documents.push({
    file: fileFor(project.id, "project.md"),
    data: {
      schemaVersion: 1,
      id: `p-${project.id}`,
      type: "project",
      name: project.name,
      archived: project.isActive ? undefined : true,
      sortOrder: projectRanks.get(project.id),
      createdAt: timestamp(project.createdAt),
    },
    body: convertBody(project.content, projectDir(project.id), `プロジェクト「${project.name}」`),
  });
}

const convertedCases = new Set<string>();
for (const item of data.cases) {
  const label = `案件「${item.name}」`;
  if (!projectsById.has(item.projectId)) {
    warnings.push(`${label}: 所属プロジェクトがないため移行しませんでした`);
    continue;
  }
  convertedCases.add(item.id);
  documents.push({
    file: fileFor(item.projectId, `wi-${item.id}.md`),
    data: {
      schemaVersion: 1,
      id: `wi-${item.id}`,
      type: "work-item",
      role: "case",
      name: item.name,
      projectId: `p-${item.projectId}`,
      // GAS cases have no status.
      status: "todo",
      archived: item.isActive ? undefined : true,
      sortOrder: caseRanks.get(item.id),
      createdAt: timestamp(item.createdAt),
    },
    body: convertBody(item.content, projectDir(item.projectId), label),
  });
}

for (const task of data.tasks) {
  const label = `タスク「${task.name}」`;
  let projectId = task.projectId;
  let caseId = task.caseId && convertedCases.has(task.caseId) ? task.caseId : "";
  if (task.caseId && !caseId)
    warnings.push(`${label}: 所属案件がないためプロジェクト直下に移行します`);
  // The case decides the folder; a mismatched projectId in the sheet is ignored.
  if (caseId) projectId = casesById.get(caseId)!.projectId;
  if (!projectsById.has(projectId)) {
    warnings.push(`${label}: 所属プロジェクトがないため移行しませんでした`);
    continue;
  }
  let status = task.status;
  if (!statuses.includes(status)) {
    warnings.push(`${label}: 不明な状態「${status}」をtodoにしました`);
    status = "todo";
  }
  // Cases and tasks share the wi- namespace; GAS data can reuse a case's ID for a task.
  const id = casesById.has(task.id) ? `wi-${task.id}-task` : `wi-${task.id}`;
  if (casesById.has(task.id)) warnings.push(`${label}: 案件と同じIDのため ${id} として移行します`);
  documents.push({
    file: fileFor(projectId, `${id}.md`),
    data: {
      schemaVersion: 1,
      id,
      type: "work-item",
      role: "task",
      name: task.name,
      ...(caseId ? { parentId: `wi-${caseId}` } : { projectId: `p-${projectId}` }),
      status,
      startDate: calendarDate(task.startedAt, `${label}の開始日`),
      dueDate: calendarDate(task.dueDate, `${label}の期限`),
      // Only done tasks carry a completion time in the extension.
      completedAt: status === "done" ? timestamp(task.completedAt) : undefined,
      archived: task.isActive ? undefined : true,
      sortOrder: taskRanks.get(task.id),
      createdAt: timestamp(task.createdAt),
    },
    body: convertBody(task.content, projectDir(projectId), label),
  });
  convertedTasks.set(task.id, id);
}

// Activity types: follow the workspace's types; only categories mapped to "new" are added.
let activityTypesText: string | undefined;
try {
  activityTypesText = await fs.readFile(activityTypesFile, "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const activityTypes = activityTypesText
  ? (JSON.parse(activityTypesText) as { schemaVersion: number; types: ActivityType[] })
  : { schemaVersion: 1, types: defaultActivityTypes.map((t) => ({ ...t })) };
if (activityTypes.schemaVersion !== 1 || !Array.isArray(activityTypes.types))
  throw new Error("activity-types.json の形式が不正です。");
const typeMap: Record<string, unknown> = values["type-map"]
  ? JSON.parse(await fs.readFile(path.resolve(values["type-map"]), "utf8"))
  : {};
const normalizeName = (name: string) => name.normalize("NFKC").trim().toLowerCase();
const sheetCategories = new Map(
  [...(data.categories ?? []), ...(data.interruptionCategories ?? [])].map((c) => [c.name, c]),
);
const usedCategories = new Map<string, number>();
for (const item of [...records, ...interruptions]) {
  const name = item.category.trim();
  if (name) usedCategories.set(name, (usedCategories.get(name) ?? 0) + 1);
}
const addedTypes: ActivityType[] = [];
const resolvedTypes = new Map<string, string>();
const unresolvedTypes: { name: string; count: number; hint?: string }[] = [];
for (const [name, count] of usedCategories) {
  const mapped = typeMap[name];
  if (mapped === "new") {
    const id = `activity-gas-${createHash("sha1").update(name).digest("hex").slice(0, 8)}`;
    const category = sheetCategories.get(name);
    const type: ActivityType = { id, name, color: tagColor(category?.color ?? "") };
    if (activityTypes.types.some((t) => t.id === id))
      throw new Error(`活動種別IDが既にあります: ${id}`);
    activityTypes.types.push(type);
    addedTypes.push(type);
    resolvedTypes.set(name, id);
  } else if (mapped !== undefined) {
    if (typeof mapped !== "string" || !activityTypes.types.some((t) => t.id === mapped))
      throw new Error(
        `--type-map の「${name}」に存在しない活動種別IDが指定されています: ${mapped}`,
      );
    resolvedTypes.set(name, mapped);
  } else {
    const match = activityTypes.types.find((t) => normalizeName(t.name) === normalizeName(name));
    if (match) resolvedTypes.set(name, match.id);
    else {
      // Partial name overlap is only a hint; the user decides.
      const hint = activityTypes.types.find(
        (t) =>
          normalizeName(name).includes(normalizeName(t.name)) ||
          normalizeName(t.name).includes(normalizeName(name)),
      );
      unresolvedTypes.push({ name, count, hint: hint?.id });
    }
  }
}
const activityTypeFor = (name: string) => resolvedTypes.get(name) ?? name;

const timeZone = data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const monthFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
});
/** activities/YYYY/MM in the spreadsheet's time zone, like the extension's local-time folders. */
function activityDir(startedAt: string) {
  const parts = monthFormat.formatToParts(new Date(startedAt));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return path.join(activitiesDir, part("year"), part("month"));
}

const convertedRecords = new Map<string, { startedAt: string; endedAt?: string }>();
let lastWorkNumber = 1;
const sortedRecords = records
  .map((record, index) => ({ record, index }))
  .sort(
    (a, b) =>
      (Date.parse(a.record.startTime) || 0) - (Date.parse(b.record.startTime) || 0) ||
      a.index - b.index,
  );
for (const { record } of sortedRecords) {
  const startedAt = timestamp(record.startTime);
  const label = `記録 ${record.id}（${record.startTime}）`;
  if (!phases.includes(record.type) || !startedAt) {
    warnings.push(`${label}: 種類または開始時刻が不正なため移行しませんでした`);
    continue;
  }
  const endedAt = timestamp(record.endTime);
  if (record.endTime && !endedAt)
    warnings.push(`${label}: 終了時刻が読めないため未終了として移行します`);
  // GAS stores the next work number on breaks; the extension uses the preceding work's number.
  let workNumber: number;
  if (record.type === "work") {
    workNumber =
      Number.isInteger(record.pomodoroSetIndex) && record.pomodoroSetIndex >= 1
        ? record.pomodoroSetIndex
        : 1;
    lastWorkNumber = workNumber;
  } else workNumber = lastWorkNumber;
  let relatedTo: { type: string; id: string } | undefined;
  if (record.taskId && convertedTasks.has(record.taskId))
    relatedTo = { type: "work-item", id: convertedTasks.get(record.taskId)! };
  else if (record.caseId && convertedCases.has(record.caseId))
    relatedTo = { type: "work-item", id: `wi-${record.caseId}` };
  else if (record.projectId && projectsById.has(record.projectId))
    relatedTo = { type: "project", id: `p-${record.projectId}` };
  else if (record.taskId || record.caseId || record.projectId)
    warnings.push(`${label}: 関連先が見つからないため関連付けを外しました`);
  const category = record.category.trim();
  const dir = activityDir(startedAt);
  documents.push({
    file: path.join(dir, `ar-${record.id}.md`),
    data: {
      schemaVersion: 1,
      id: `ar-${record.id}`,
      type: "activity-record",
      name: record.type === "work" ? titleFrom(record.content) : undefined,
      activityTypeId: category
        ? activityTypeFor(category)
        : record.type === "work"
          ? workTypeId
          : awayTypeId,
      session: { phase: record.type, workNumber },
      startedAt,
      endedAt,
      relatedTo,
    },
    body: convertBody(record.content, dir, label),
  });
  convertedRecords.set(record.id, { startedAt, endedAt });
}

const intervalsByParent = new Map<string, { start: number; end: number; label: string }[]>();
for (const item of interruptions) {
  const label = `中断 ${item.id}（${item.startTime}）`;
  const parent = convertedRecords.get(item.pomodoroId);
  const startedAt = timestamp(item.startTime);
  if (!parent || !startedAt) {
    warnings.push(`${label}: 元の記録または開始時刻がないため移行しませんでした`);
    continue;
  }
  const endedAt = timestamp(item.endTime);
  const category = item.category.trim();
  const dir = activityDir(startedAt);
  documents.push({
    file: path.join(dir, `ar-${item.id}.md`),
    data: {
      schemaVersion: 1,
      id: `ar-${item.id}`,
      type: "activity-record",
      name: titleFrom(item.content),
      activityTypeId: category
        ? activityTypeFor(category)
        : item.type === "work"
          ? workTypeId
          : awayTypeId,
      parentActivityId: `ar-${item.pomodoroId}`,
      startedAt,
      endedAt,
    },
    body: convertBody(item.content, dir, label),
  });
  const list = intervalsByParent.get(item.pomodoroId) ?? [];
  list.push({ start: Date.parse(startedAt), end: endedAt ? Date.parse(endedAt) : NaN, label });
  intervalsByParent.set(item.pomodoroId, list);
}
// The extension reports, but never repairs, interruptions outside or overlapping their work record.
for (const [parentId, list] of intervalsByParent) {
  const parent = convertedRecords.get(parentId)!;
  const start = Date.parse(parent.startedAt),
    end = parent.endedAt ? Date.parse(parent.endedAt) : NaN;
  let previousEnd = start;
  for (const part of list.sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(part.end) ||
      part.start < start ||
      part.end > end ||
      part.end < part.start ||
      part.start < previousEnd
    )
      warnings.push(
        `${part.label}: 時刻が作業記録の範囲外か重複しています（拡張でエラー表示されます）`,
      );
    previousEnd = Math.max(previousEnd, part.end);
  }
}

// Catch collisions before anything is written so a run never stops halfway.
for (const [key, values] of [
  ["ID", documents.map((d) => String(d.data.id))],
  ["ファイル", documents.map((d) => d.file)],
] as const) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`出力の${key}が重複しています: ${value}`);
    seen.add(value);
  }
}
const targets = [...documents.map((d) => d.file), ...imageCopies.keys()];
const existing: string[] = [];
for (const target of targets) {
  try {
    await fs.access(target);
    existing.push(target);
  } catch {
    // Missing is the expected state.
  }
}

for (const failed of data.failedImages)
  warnings.push(`書き出し時に取得できなかった画像: ${failed.fileId}（${failed.error}）`);
if (data.pendingImages.length)
  warnings.push(
    `書き出しが途中の画像が ${data.pendingImages.length} 件あります。exportForVscode() を再実行してください`,
  );
for (const warning of warnings) console.warn(`警告: ${warning}`);
const count = (role: string) => documents.filter((d) => d.data.role === role).length;
const activityCount = (child: boolean) =>
  documents.filter((d) => d.data.type === "activity-record" && !!d.data.parentActivityId === child)
    .length;
console.log(
  `プロジェクト ${data.projects.length}件・案件 ${count("case")}件・タスク ${count("task")}件・` +
    `記録 ${activityCount(false)}件・中断 ${activityCount(true)}件、` +
    `画像 ${imageCopies.size}件（不足 ${missingImages.size}件）`,
);
for (const [name, id] of resolvedTypes)
  console.log(`活動種別の対応: ${name}（${usedCategories.get(name)}件） → ${id}`);
for (const type of addedTypes)
  console.log(
    `活動種別を追加: ${type.name}（${type.id}, ${type.color}${type.archived ? ", アーカイブ" : ""}）`,
  );
if (unresolvedTypes.length) {
  console.error("活動種別に対応付けられないカテゴリがあります:");
  for (const item of unresolvedTypes)
    console.error(`  ${item.name}（${item.count}件）${item.hint ? ` 候補: ${item.hint}` : ""}`);
  console.error("既存の種別: " + activityTypes.types.map((t) => `${t.id}（${t.name}）`).join(", "));
  console.error(
    '--type-map に既存の種別IDか "new"（種別を追加）を指定してください。例:\n' +
      JSON.stringify(
        Object.fromEntries(unresolvedTypes.map((item) => [item.name, item.hint ?? "new"])),
        null,
        2,
      ),
  );
}
if (unresolvedTypes.length && !dryRun) process.exit(1);
if (existing.length) {
  console.error("既にファイルがあるため中止しました:");
  for (const file of existing) console.error(`  ${path.relative(workspace, file)}`);
  process.exit(1);
}
if (dryRun) {
  console.log("--dry-run のため書き込みませんでした。");
  process.exit(0);
}
if (addedTypes.length) {
  await fs.mkdir(path.dirname(activityTypesFile), { recursive: true });
  // Fail if the file changed while converting rather than dropping someone's edit.
  let current: string | undefined;
  try {
    current = await fs.readFile(activityTypesFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current !== activityTypesText) throw new Error("activity-types.json が変更されました。");
  await fs.writeFile(activityTypesFile, JSON.stringify(activityTypes, null, 2) + "\n");
}
for (const doc of documents) {
  await fs.mkdir(path.dirname(doc.file), { recursive: true });
  await fs.writeFile(doc.file, serialize(doc), { flag: "wx" });
}
for (const [destination, source] of imageCopies) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
}
console.log(`${workspace} に書き出しました。`);
