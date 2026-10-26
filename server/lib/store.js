import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBytes, nowIso } from "./text.js";
import { explainedPagesOf, pageExplanationsOf, taughtPageCounts } from "./pages.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "../..");

export const DATA_DIR = resolve(process.env.PROFESSORAI_DATA_DIR || join(ROOT, ".professorai-data"));
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
const CATALOG_PATH = join(DATA_DIR, "catalog.json");

let catalogCache = null;
let queue = Promise.resolve();

export function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function ensureStorage() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

function emptyCatalog() {
  return { version: 2, settings: { modelId: "" }, courses: [] };
}

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  await ensureStorage();

  try {
    const raw = await readFile(CATALOG_PATH, "utf8");
    const loaded = JSON.parse(raw);
    if (!loaded || loaded.version !== 2 || !Array.isArray(loaded.courses)) {
      throw new Error("The course catalog has an unsupported format. Restore a valid catalog before continuing.");
    }
    let migrated = false;
    for (const course of loaded.courses) {
      if (!Array.isArray(course.pageExplanations)) {
        course.pageExplanations = pageExplanationsOf(course);
        migrated = true;
      }
    }
    if (migrated) await persist(loaded);
    catalogCache = loaded;
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
    const initial = emptyCatalog();
    await persist(initial);
    catalogCache = initial;
  }

  if (!catalogCache || catalogCache.version !== 2 || !Array.isArray(catalogCache.courses)) {
    catalogCache = null;
    throw new Error("The course catalog has an unsupported format. Restore a valid catalog before continuing.");
  }

  if (!catalogCache.settings || typeof catalogCache.settings !== "object") {
    catalogCache.settings = { modelId: "" };
  }

  return catalogCache;
}

async function persist(catalog) {
  await ensureStorage();
  const tempPath = `${CATALOG_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(catalog, null, 2), "utf8");
    await rename(tempPath, CATALOG_PATH);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

export function readCatalog() {
  return enqueue(async () => structuredClone(await loadCatalog()));
}

export function updateCatalog(mutator) {
  return enqueue(async () => {
    const catalog = structuredClone(await loadCatalog());
    const result = await mutator(catalog);
    await persist(catalog);
    catalogCache = catalog;
    return structuredClone(result);
  });
}

export function findCourse(catalog, courseId) {
  return catalog.courses.find((course) => course.id === courseId) || null;
}

export function summarizeDocument(document) {
  return {
    id: document.id,
    name: document.name,
    originalName: document.originalName,
    extension: document.extension,
    mimeType: document.mimeType,
    size: document.size,
    sizeLabel: formatBytes(document.size),
    status: document.status,
    error: document.error || "",
    warnings: document.warnings || [],
    parser: document.parser || "",
    pageUnit: document.pageUnit,
    totalPages: document.pages?.length || 0,
    readablePages: (document.pages || []).filter((page) => page.text && !page.text.startsWith("[No extractable text")).length,
    createdAt: document.createdAt,
  };
}

export function courseSummary(course) {
  const lessons = [];
  for (const module of course.syllabus?.modules || []) {
    for (const lesson of module.lessons || []) lessons.push(lesson);
  }
  const current = lessons.find((lesson) => lesson.id === course.progress?.lessonId) || lessons[0] || null;
  const counts = taughtPageCounts(course);
  const documents = (course.documents || []).map((document) => ({ ...summarizeDocument(document), taughtPages: counts.get(document.id) || 0 }));
  return {
    id: course.id,
    title: course.title,
    promise: course.promise || "",
    status: course.status,
    buildStep: course.buildStep || "",
    error: course.error || "",
    tutorMode: course.tutorMode || "notes",
    modelId: course.modelId || "",
    modelLabel: course.modelLabel || "",
    learner: course.learner,
    documents,
    totalPages: documents.reduce((sum, document) => sum + document.totalPages, 0),
    taughtPages: documents.reduce((sum, document) => sum + document.taughtPages, 0),
    lessonCount: lessons.length,
    minutes: lessons.reduce((sum, lesson) => sum + (Number(lesson.minutes) || 0), 0),
    moduleCount: course.syllabus?.modules?.length || 0,
    progress: course.progress,
    currentLessonTitle: current?.title || "",
    preparedLessonIds: Object.keys(course.scripts || {}),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

export function courseDetail(course) {
  return {
    ...courseSummary(course),
    syllabus: course.syllabus || { modules: [] },
    chat: course.chat || [],
    explainedPages: explainedPagesOf(course),
  };
}

export function touch(entity) {
  entity.updatedAt = nowIso();
  return entity;
}
