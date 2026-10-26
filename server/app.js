import compression from "compression";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ALLOWED_EXTENSIONS, MIME_TYPES, getPageUnit, normalizeExtension, parseDocument, readablePageCount } from "./lib/parse.js";
import {
  DATA_DIR,
  UPLOAD_DIR,
  courseDetail,
  courseSummary,
  ensureStorage,
  findCourse,
  readCatalog,
  summarizeDocument,
  touch,
  updateCatalog,
} from "./lib/store.js";
import { assertSelectable, modelCatalog, modelLabel, resolveModelId } from "./lib/models.js";
import { formatBytes, nowIso, safeDisplayName } from "./lib/text.js";
import { explainedPagesOf, pageChatHistory, pageChatRevision, pageExplanationsOf, resetPageChat, studyPages } from "./lib/pages.js";
import {
  createScript,
  createSyllabus,
  learnerKey,
  lessonContext,
  listLessons,
  listReadablePages,
  normalizeLearner,
  streamAnswer,
  streamPageAnswer,
  streamPageExplanation,
} from "./lib/tutor.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIST = join(__dirname, "../client/dist");
const PDF_ASSETS = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const MAX_FILES = 8;

const app = express();
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await mkdir(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${normalizeExtension(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const extension = normalizeExtension(file.originalname);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      cb(Object.assign(new Error("Upload PDF, TXT, DOC, DOCX, PPT, or PPTX files."), { statusCode: 415 }));
      return;
    }
    cb(null, true);
  },
});

const scriptLocks = new Map();

function sendJson(res, statusCode, payload) {
  res.status(statusCode).type("application/json; charset=utf-8").send(payload);
}

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await rm(file.path, { force: true }).catch(() => {});
}

async function removeUploadedFiles(files) {
  await Promise.all((files || []).map((file) => removeUploadedFile(file)));
}

function blankProgress(syllabus) {
  const first = listLessons(syllabus)[0];
  return {
    lessonId: first?.id || "",
    beatIndex: 0,
    completedLessonIds: [],
    paused: false,
    page: null,
    updatedAt: nowIso(),
  };
}

function chatMessage({ role, kind, documentId, page, text, chatRevision = 0 }) {
  return {
    id: randomUUID(),
    role,
    kind,
    documentId,
    page: Number(page),
    text,
    chatRevision,
    createdAt: nowIso(),
  };
}

async function ingestFile(file) {
  const extension = normalizeExtension(file.originalname);
  const id = randomUUID();
  const storageName = `${id}${extension}`;
  const storagePath = join(UPLOAD_DIR, storageName);
  await rename(file.path, storagePath);
  file.path = storagePath;

  const record = {
    id,
    name: safeDisplayName(file.originalname.replace(new RegExp(`${extension}$`, "i"), ""), "Course material"),
    originalName: safeDisplayName(file.originalname, "course-material"),
    extension,
    mimeType: file.mimetype || MIME_TYPES[extension] || "application/octet-stream",
    size: file.size,
    storageName,
    status: "processing",
    error: "",
    warnings: [],
    parser: "",
    pageUnit: getPageUnit(extension),
    pages: [],
    createdAt: nowIso(),
  };

  try {
    const parsed = await parseDocument(storagePath, extension);
    record.status = parsed.status;
    record.pageUnit = parsed.pageUnit;
    record.pages = parsed.pages;
    record.parser = parsed.parser;
    record.warnings = parsed.warnings;
    if (record.status === "ready" && readablePageCount(record.pages) === 0) {
      record.status = "error";
      record.error = "No readable text was found in this file.";
    }
  } catch (error) {
    record.status = "error";
    record.error = error instanceof Error ? error.message : "Document processing failed.";
  }

  return record;
}

function scheduleSyllabus(courseId) {
  void buildSyllabus(courseId).catch((error) => {
    console.error("Syllabus build failed:", error instanceof Error ? error.message : error);
  });
}

async function buildSyllabus(courseId) {
  const snapshot = await updateCatalog(async (catalog) => {
    const course = findCourse(catalog, courseId);
    if (!course) return null;
    course.status = "building";
    course.buildId = randomUUID();
    course.buildStep = "reading";
    course.error = "";
    touch(course);
    return structuredClone({
      id: course.id,
      buildId: course.buildId,
      documents: course.documents,
      learner: course.learner,
      modelId: resolveModelId(catalog.settings?.modelId),
    });
  });

  if (!snapshot) return;

  await updateCatalog(async (catalog) => {
    const course = findCourse(catalog, courseId);
    if (!course || course.buildId !== snapshot.buildId) return;
    course.buildStep = "shaping";
    touch(course);
  });

  try {
    const readable = snapshot.documents.filter((document) => document.status === "ready" && readablePageCount(document.pages));
    if (!readable.length) {
      const warning = snapshot.documents.find((document) => document.error || document.warnings?.[0]);
      throw new Error(warning?.error || warning?.warnings?.[0] || "None of the uploaded files had readable text.");
    }

    const { syllabus, tutorMode, modelId } = await createSyllabus({
      documents: readable,
      learner: snapshot.learner,
      live: Boolean(snapshot.modelId),
      modelId: snapshot.modelId,
    });

    await updateCatalog(async (catalog) => {
      const course = findCourse(catalog, courseId);
      if (!course || course.buildId !== snapshot.buildId) return;
      course.syllabus = syllabus;
      course.promise = syllabus.promise || "";
      course.tutorMode = tutorMode;
      course.modelId = modelId || "";
      course.modelLabel = modelLabel(modelId);
      course.scripts = {};
      const savedPage = course.progress?.page || null;
      course.progress = blankProgress(syllabus);
      course.progress.page = savedPage;
      course.status = "ready";
      course.buildStep = "ready";
      course.error = "";
      touch(course);
    });
  } catch (error) {
    await updateCatalog(async (catalog) => {
      const course = findCourse(catalog, courseId);
      if (!course || course.buildId !== snapshot.buildId) return;
      course.status = "error";
      course.buildStep = "error";
      course.error = error instanceof Error ? error.message : "The course path could not be built.";
      touch(course);
    });
  }
}

function sourcePayload(script) {
  return (script?.sources || []).map((source) => ({
    documentId: source.documentId,
    documentName: source.documentName,
    page: source.page,
    unit: source.unit,
    excerpt: source.excerpt,
  }));
}

function teachingKey(learner, modelId) {
  return `${learnerKey(learner)}|${modelId || ""}`;
}

async function prepareScript(courseId, lessonId, { refresh = false } = {}) {
  const key = `${courseId}:${lessonId}:${refresh ? "refresh" : "cache"}`;
  if (!scriptLocks.has(key)) {
    scriptLocks.set(
      key,
      generateScript(courseId, lessonId, { refresh }).finally(() => scriptLocks.delete(key)),
    );
  }
  return scriptLocks.get(key);
}

async function generateScript(courseId, lessonId, { refresh = false } = {}) {
  const snapshot = await readCatalog().then((catalog) => {
    const course = findCourse(catalog, courseId);
    if (!course) return null;
    const context = lessonContext(course.syllabus, lessonId);
    if (!context.lesson) return { missing: true };
    const modelId = resolveModelId(catalog.settings?.modelId);
    const profile = teachingKey(course.learner, modelId);
    const cached = course.scripts?.[lessonId];
    if (!refresh && cached && cached.profileKey === profile) {
      return { cached: true, course, script: cached, lesson: context.lesson };
    }
    return {
      cached: false,
      profile,
      modelId,
      data: structuredClone({
        documents: course.documents,
        syllabus: course.syllabus,
        learner: course.learner,
        notes: course.notes || [],
        lesson: context.lesson,
      }),
    };
  });

  if (!snapshot) {
    throw Object.assign(new Error("Course not found."), { statusCode: 404 });
  }
  if (snapshot.missing) {
    throw Object.assign(new Error("Lesson not found."), { statusCode: 404 });
  }
  if (snapshot.cached) return snapshot;

  const script = await createScript({
    documents: snapshot.data.documents,
    syllabus: snapshot.data.syllabus,
    lesson: snapshot.data.lesson,
    learner: snapshot.data.learner,
    notes: snapshot.data.notes,
    live: Boolean(snapshot.modelId),
    modelId: snapshot.modelId,
  });
  const stored = {
    ...script,
    modelLabel: modelLabel(script.modelId),
    profileKey: snapshot.profile,
    lessonId,
    createdAt: nowIso(),
  };

  await updateCatalog(async (catalog) => {
    const course = findCourse(catalog, courseId);
    if (!course) return;
    if (teachingKey(course.learner, resolveModelId(catalog.settings?.modelId)) !== snapshot.profile) return;
    course.scripts = course.scripts || {};
    course.scripts[lessonId] = stored;
    touch(course);
  });

  return { script: stored, lesson: snapshot.data.lesson };
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'wasm-unsafe-eval'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
      },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: "1mb" }));

for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  app.use(`/pdf-assets/${folder}`, express.static(join(PDF_ASSETS, folder), { maxAge: "1d" }));
}

app.get(
  "/api/health",
  asyncHandler(async (_req, res) => {
    const catalog = await readCatalog();
    const models = modelCatalog(catalog.settings?.modelId);
    sendJson(res, 200, {
      ok: true,
      tutor: models.live ? "live" : "notes",
      modelId: models.selected,
      modelLabel: models.selectedLabel,
      dataDir: DATA_DIR,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  }),
);

app.get(
  "/api/models",
  asyncHandler(async (_req, res) => {
    const catalog = await readCatalog();
    sendJson(res, 200, modelCatalog(catalog.settings?.modelId));
  }),
);

app.put(
  "/api/settings",
  asyncHandler(async (req, res) => {
    const modelId = assertSelectable(String(req.body?.modelId || ""));
    await updateCatalog(async (catalog) => {
      const previous = catalog.settings?.modelId || "";
      catalog.settings = { ...(catalog.settings || {}), modelId };
      if (previous !== modelId) {
        for (const course of catalog.courses) course.scripts = {};
      }
    });
    sendJson(res, 200, modelCatalog(modelId));
  }),
);

app.get(
  "/api/courses",
  asyncHandler(async (_req, res) => {
    const catalog = await readCatalog();
    const courses = [...catalog.courses]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(courseSummary);
    sendJson(res, 200, { courses });
  }),
);

app.post(
  "/api/courses",
  upload.array("materials", MAX_FILES),
  asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      sendJson(res, 400, { error: "Add at least one PDF, set of notes, or slide deck." });
      return;
    }

    const learner = normalizeLearner({
      name: req.body?.name,
      background: req.body?.background,
      style: req.body?.style,
      pace: req.body?.pace,
    });

    const documents = [];
    try {
      for (const file of files) {
        documents.push(await ingestFile(file));
      }
    } catch (error) {
      await removeUploadedFiles(files);
      throw error;
    }

    const named = String(req.body?.title || "").trim().slice(0, 80);
    const course = await updateCatalog(async (catalog) => {
      const created = {
        id: randomUUID(),
        title: named || documents[0]?.name || "Course",
        promise: "",
        status: "building",
        buildStep: "reading",
        error: "",
        tutorMode: resolveModelId("") ? "live" : "notes",
        learner,
        documents,
        syllabus: { modules: [] },
        scripts: {},
        notes: [],
        chat: [],
        pageExplanations: [],
        progress: blankProgress(null),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      catalog.courses.push(created);
      return created;
    }).catch(async (error) => {
      await removeUploadedFiles(files);
      throw error;
    });

    scheduleSyllabus(course.id);
    sendJson(res, 201, { course: courseDetail(course) });
  }),
);

app.get(
  "/api/courses/:courseId",
  asyncHandler(async (req, res) => {
    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    sendJson(res, 200, { course: courseDetail(course) });
  }),
);

app.patch(
  "/api/courses/:courseId",
  asyncHandler(async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title)) {
      sendJson(res, 400, { error: "Use a course name between 1 and 80 characters, without control characters." });
      return;
    }
    const course = await updateCatalog((catalog) => {
      const current = findCourse(catalog, req.params.courseId);
      if (!current) return null;
      current.title = title;
      touch(current);
      return current;
    });
    if (!course) { sendJson(res, 404, { error: "Course not found." }); return; }
    sendJson(res, 200, { course: courseDetail(course) });
  }),
);

app.delete(
  "/api/courses/:courseId",
  asyncHandler(async (req, res) => {
    const removed = await updateCatalog(async (catalog) => {
      const index = catalog.courses.findIndex((course) => course.id === req.params.courseId);
      if (index < 0) return null;
      const [course] = catalog.courses.splice(index, 1);
      return course;
    });

    if (!removed) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }

    await Promise.all(
      (removed.documents || []).map((document) => rm(join(UPLOAD_DIR, basename(document.storageName)), { force: true })),
    );
    sendJson(res, 200, { ok: true });
  }),
);

app.post(
  "/api/courses/:courseId/materials",
  upload.array("materials", MAX_FILES),
  asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      sendJson(res, 400, { error: "Choose a file to add." });
      return;
    }

    const existing = await readCatalog().then((catalog) => findCourse(catalog, req.params.courseId));
    if (!existing) {
      await removeUploadedFiles(files);
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    if ((existing.documents?.length || 0) + files.length > 12) {
      await removeUploadedFiles(files);
      sendJson(res, 400, { error: "A course can hold up to 12 files." });
      return;
    }

    const documents = [];
    try {
      for (const file of files) documents.push(await ingestFile(file));
    } catch (error) {
      await removeUploadedFiles(files);
      throw error;
    }

    const course = await updateCatalog(async (catalog) => {
      const current = findCourse(catalog, req.params.courseId);
      if (!current) return null;
      if (current.documents.length + documents.length > 12) {
        throw Object.assign(new Error("A course can hold up to 12 files."), { statusCode: 400 });
      }
      current.documents.push(...documents);
      current.status = "building";
      current.buildStep = "reading";
      current.scripts = {};
      touch(current);
      return current;
    }).catch(async (error) => {
      await removeUploadedFiles(files);
      throw error;
    });

    if (!course) {
      await removeUploadedFiles(files);
      sendJson(res, 404, { error: "Course not found." });
      return;
    }

    scheduleSyllabus(course.id);
    sendJson(res, 201, { course: courseDetail(course) });
  }),
);

app.post(
  "/api/courses/:courseId/rebuild",
  asyncHandler(async (req, res) => {
    const course = await updateCatalog(async (catalog) => {
      const current = findCourse(catalog, req.params.courseId);
      if (!current) return null;
      current.status = "building";
      current.buildStep = "reading";
      current.error = "";
      current.scripts = {};
      touch(current);
      return current;
    });

    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }

    scheduleSyllabus(course.id);
    sendJson(res, 202, { course: courseDetail(course) });
  }),
);

app.patch(
  "/api/courses/:courseId/learner",
  asyncHandler(async (req, res) => {
    const learner = normalizeLearner(req.body || {});
    const course = await updateCatalog(async (catalog) => {
      const current = findCourse(catalog, req.params.courseId);
      if (!current) return null;
      const changed = learnerKey(current.learner) !== learnerKey(learner);
      current.learner = learner;
      if (changed) current.scripts = {};
      touch(current);
      return current;
    });

    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    sendJson(res, 200, { course: courseDetail(course) });
  }),
);

app.put(
  "/api/courses/:courseId/progress",
  asyncHandler(async (req, res) => {
    const course = await updateCatalog(async (catalog) => {
      const current = findCourse(catalog, req.params.courseId);
      if (!current) return null;
      const lessons = listLessons(current.syllabus);
      const known = new Set(lessons.map((lesson) => lesson.id));
      const requestedId = known.has(req.body?.lessonId) ? req.body.lessonId : current.progress?.lessonId || lessons[0]?.id || "";
      const lesson = lessons.find((item) => item.id === requestedId);
      const beatCount = current.scripts?.[requestedId]?.beats?.length || 0;
      const requestedBeat = Number(req.body?.beatIndex ?? current.progress?.beatIndex ?? 0);
      const beatIndex = Number.isInteger(requestedBeat) && requestedBeat >= 0 ? requestedBeat : 0;
      const requestedPage = req.body?.page;
      const knownPage = studyPages(current).find(
        (item) => item.documentId === requestedPage?.documentId && item.number === Number(requestedPage?.number),
      );
      current.progress = {
        lessonId: lesson?.id || "",
        beatIndex: beatCount ? Math.min(beatIndex, beatCount - 1) : beatIndex,
        completedLessonIds: [...new Set(Array.isArray(req.body?.completedLessonIds) ? req.body.completedLessonIds : current.progress?.completedLessonIds || [])].filter((id) =>
          known.has(id),
        ),
        paused: typeof req.body?.paused === "boolean" ? req.body.paused : Boolean(current.progress?.paused),
        page: knownPage
          ? { documentId: knownPage.documentId, number: knownPage.number }
          : current.progress?.page || null,
        updatedAt: nowIso(),
      };
      touch(current);
      return current;
    });

    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    sendJson(res, 200, { progress: course.progress });
  }),
);

app.post(
  "/api/courses/:courseId/lessons/:lessonId/script",
  asyncHandler(async (req, res) => {
    const refresh = req.query.refresh === "1" || req.body?.refresh === true;
    const prepared = await prepareScript(req.params.courseId, req.params.lessonId, { refresh });
    sendJson(res, 200, {
      lesson: {
        id: prepared.lesson.id,
        title: prepared.lesson.title,
        objective: prepared.lesson.objective,
        minutes: prepared.lesson.minutes,
        concepts: prepared.lesson.concepts || [],
        moduleTitle: prepared.lesson.moduleTitle,
      },
      beats: prepared.script.beats,
      source: prepared.script.source,
      modelId: prepared.script.modelId || "",
      modelLabel: prepared.script.modelLabel || modelLabel(prepared.script.modelId),
      sources: sourcePayload(prepared.script),
    });
  }),
);

app.get(
  "/api/courses/:courseId/pages",
  asyncHandler(async (req, res) => {
    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    sendJson(res, 200, { pages: studyPages(course) });
  }),
);

app.post(
  "/api/courses/:courseId/explain",
  asyncHandler(async (req, res) => {
    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    if (!course) { sendJson(res, 404, { error: "Course not found." }); return; }
    const page = studyPages(course).find(
      (item) => item.documentId === req.body?.documentId && item.number === Number(req.body?.page),
    );
    if (!page) { sendJson(res, 404, { error: "That page is not in this course." }); return; }
    if (!page.canExplain) {
      sendJson(res, 422, { error: "This page has no readable text to explain. You can still view the original PDF." });
      return;
    }
    const revision = pageChatRevision(course, page.documentId, page.number);
    if (req.body?.chatRevision !== undefined && req.body.chatRevision !== revision) {
      sendJson(res, 409, { error: "This page chat has changed. Reopen the page and try again." });
      return;
    }

    // Record navigation when requested, so a slow explanation cannot move the
    // reader back to a page they have already left.
    await updateCatalog((catalogState) => {
      const current = findCourse(catalogState, course.id);
      if (!current) return;
      if (pageChatRevision(current, page.documentId, page.number) !== revision) throw Object.assign(new Error("The page chat was reset. Start a new explanation."), { statusCode: 409 });
      current.progress = {
        ...(current.progress || blankProgress(current.syllabus)),
        page: { documentId: page.documentId, number: page.number },
        paused: true,
        updatedAt: nowIso(),
      };
      touch(current);
    });
    const existing = pageExplanationsOf(course).find(
      (record) => record.documentId === page.documentId && record.page === page.number,
    );
    openSse(res);
    if (existing) {
      writeSse(res, "done", { text: existing.text, explainedAt: existing.explainedAt, explainedPages: explainedPagesOf(course), chat: course.chat || [] });
      res.end();
      return;
    }
    const modelId = resolveModelId(catalog.settings?.modelId);
    let explanation;
    try {
      explanation = await streamPageExplanation({ page, learner: course.learner, history: pageChatHistory(course, page.documentId, page.number), live: Boolean(modelId), modelId },
        (delta) => writeSse(res, "delta", { delta }));
    } catch (error) {
      writeSse(res, "error", { error: error instanceof Error ? error.message : "The page could not be explained." });
      res.end();
      return;
    }
    if (!explanation?.trim()) throw new Error("The tutor returned an empty explanation.");
    const message = chatMessage({ role: "teacher", kind: "explain", documentId: page.documentId, page: page.number, text: explanation.slice(0, 8000), chatRevision: revision });
    const saved = await updateCatalog((catalogState) => {
      const current = findCourse(catalogState, course.id);
      if (!current) return null;
      if (pageChatRevision(current, page.documentId, page.number) !== revision) return { stale: true };
      const records = pageExplanationsOf(current);
      let record = records.find((item) => item.documentId === page.documentId && item.page === page.number);
      if (!record) {
        record = { documentId: page.documentId, page: page.number, text: message.text, explainedAt: message.createdAt, modelId };
        records.push(record);
        current.chat = [...(current.chat || []), message].slice(-200);
      }
      current.pageExplanations = records;
      touch(current);
      return { text: record.text, explainedAt: record.explainedAt, explainedPages: explainedPagesOf(current), chat: current.chat || [] };
    });
    if (saved?.stale) {
      writeSse(res, "error", { error: "The page chat was reset. Start a new explanation." });
      res.end();
      return;
    }
    writeSse(res, "done", saved || { text: explanation, explainedPages: [], chat: [] });
    res.end();
  }),
);

app.delete(
  "/api/courses/:courseId/documents/:documentId/pages/:page/chat",
  asyncHandler(async (req, res) => {
    const number = Number(req.params.page);
    const result = await updateCatalog((catalog) => {
      const course = findCourse(catalog, req.params.courseId);
      if (!course) return null;
      const page = studyPages(course).find((item) => item.documentId === req.params.documentId && item.number === number);
      if (!page) return null;
      resetPageChat(course, page.documentId, page.number);
      touch(course);
      return { course: courseDetail(course), page: studyPages(course).find((item) => item.documentId === page.documentId && item.number === page.number) };
    });
    if (!result) { sendJson(res, 404, { error: "Page not found." }); return; }
    sendJson(res, 200, result);
  }),
);

app.post(
  "/api/courses/:courseId/ask",
  asyncHandler(async (req, res) => {
    const question = String(req.body?.question || "").trim();
    const mode = req.body?.mode === "check" ? "check" : "interrupt";
    if (!question) {
      sendJson(res, 400, { error: "Ask a question first." });
      return;
    }
    if (question.length > 2000) {
      sendJson(res, 400, { error: "Keep the question under 2000 characters." });
      return;
    }

    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    if (req.body?.documentId) {
      if (!course) {
        sendJson(res, 404, { error: "Course not found." });
        return;
      }
      const page = listReadablePages(course.documents).find(
        (item) => item.documentId === req.body.documentId && item.number === Number(req.body.page),
      );
      if (!page) {
        sendJson(res, 404, { error: "That page is not in this course." });
        return;
      }
      const snapshot = {
        question,
        page,
        learner: course.learner,
        history: pageChatHistory(course, page.documentId, page.number),
        live: Boolean(resolveModelId(catalog.settings?.modelId)),
        modelId: resolveModelId(catalog.settings?.modelId),
      };
      const revision = pageChatRevision(course, page.documentId, page.number);
      if (req.body?.chatRevision !== undefined && req.body.chatRevision !== revision) {
        sendJson(res, 409, { error: "This page chat has changed. Reopen the page and try again." });
        return;
      }
      openSse(res);
      let answer = "";
      try {
        answer = await streamPageAnswer(snapshot, (delta) => {
          answer += delta;
          writeSse(res, "delta", { delta });
        });
      } catch (error) {
        writeSse(res, "error", { error: error instanceof Error ? error.message : "The tutor could not answer." });
        res.end();
        return;
      }
      const saved = await updateCatalog(async (catalogState) => {
        const current = findCourse(catalogState, req.params.courseId);
        if (!current) return null;
        if (pageChatRevision(current, page.documentId, page.number) !== revision) return { stale: true };
        current.chat = [
          ...(current.chat || []),
          chatMessage({
            role: "student",
            kind: "question",
            chatRevision: revision,
            documentId: page.documentId,
            page: page.number,
            text: question.slice(0, 2000),
          }),
          chatMessage({
            role: "teacher",
            kind: "answer",
            chatRevision: revision,
            documentId: page.documentId,
            page: page.number,
            text: answer.slice(0, 8000),
          }),
        ].slice(-200);
        current.progress = {
          ...(current.progress || blankProgress(current.syllabus)),
          page: { documentId: page.documentId, number: page.number },
          paused: true,
          updatedAt: nowIso(),
        };
        touch(current);
        return current.chat;
      });
      if (saved?.stale) {
        writeSse(res, "error", { error: "The page chat was reset. Ask your question again." });
        res.end();
        return;
      }
      writeSse(res, "done", { text: answer, chat: saved || [] });
      res.end();
      return;
    }

    if (!course) {
      sendJson(res, 404, { error: "Course not found." });
      return;
    }
    const context = lessonContext(course.syllabus, req.body?.lessonId);
    if (!context.lesson) {
      sendJson(res, 404, { error: "Lesson not found." });
      return;
    }

    const script = course.scripts?.[context.lesson.id];
    if (!script) {
      sendJson(res, 409, { error: "Open the lesson before asking about it." });
      return;
    }

    const snapshot = structuredClone({
      mode,
      question,
      documents: course.documents,
      syllabus: course.syllabus,
      lesson: context.lesson,
      beatIndex: Number(req.body?.beatIndex) || 0,
      script,
      learner: course.learner,
      notes: course.notes || [],
      live: Boolean(resolveModelId(catalog.settings?.modelId)),
      modelId: resolveModelId(catalog.settings?.modelId),
    });

    openSse(res);
    let answer = "";
    try {
      answer = await streamAnswer(snapshot, (delta) => {
        answer += delta;
        writeSse(res, "delta", { delta });
      });
      writeSse(res, "done", { text: answer });
      res.end();
    } catch (error) {
      writeSse(res, "error", { error: error instanceof Error ? error.message : "The tutor could not answer." });
      res.end();
      return;
    }

    const note = {
      at: nowIso(),
      lessonId: context.lesson.id,
      lessonTitle: context.lesson.title,
      question: question.slice(0, 300),
      answerExcerpt: answer.slice(0, 500),
    };
    await updateCatalog(async (catalogState) => {
      const current = findCourse(catalogState, req.params.courseId);
      if (!current) return;
      current.notes = [...(current.notes || []), note].slice(-24);
      if (current.progress) {
        current.progress.paused = true;
        current.progress.updatedAt = nowIso();
      }
      touch(current);
    }).catch(() => {});
  }),
);

app.get(
  "/api/courses/:courseId/documents/:documentId/file",
  asyncHandler(async (req, res) => {
    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    const document = course?.documents?.find((item) => item.id === req.params.documentId);
    if (!document) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }

    const filePath = join(UPLOAD_DIR, basename(document.storageName));
    try {
      await stat(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      sendJson(res, 404, { error: "The original file is no longer available." });
      return;
    }
    res.setHeader("Content-Type", MIME_TYPES[document.extension] || document.mimeType || "application/octet-stream");
    res.attachment(document.originalName);
    res.setHeader("Content-Disposition", res.getHeader("Content-Disposition").replace(/^attachment/, "inline"));
    // This exact catalog-selected file lives inside the hidden data directory.
    res.sendFile(filePath, { dotfiles: "allow" });
  }),
);

app.get(
  "/api/courses/:courseId/documents/:documentId",
  asyncHandler(async (req, res) => {
    const catalog = await readCatalog();
    const course = findCourse(catalog, req.params.courseId);
    const document = course?.documents?.find((item) => item.id === req.params.documentId);
    if (!document) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }
    sendJson(res, 200, { document: summarizeDocument(document) });
  }),
);

app.use("/api", (_req, res) => {
  sendJson(res, 404, { error: "API route not found." });
});

app.use(
  express.static(CLIENT_DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${join("client", "dist", "assets")}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-store");
      }
      const mimeType = MIME_TYPES[extname(filePath)];
      if (mimeType) res.setHeader("Content-Type", mimeType);
    },
  }),
);

app.get(/.*/, (_req, res) => {
  res.sendFile(join(CLIENT_DIST, "index.html"), (error) => {
    if (error && !res.headersSent) {
      res.status(404).type("text/plain").send("The Professor client is not built. Use npm run dev, or npm start.");
    }
  });
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `Each file can be up to ${formatBytes(MAX_UPLOAD_BYTES)}.`
        : error.code === "LIMIT_FILE_COUNT"
          ? `You can add up to ${MAX_FILES} files at a time.`
          : error.message;
    sendJson(res, 400, { error: message });
    return;
  }

  const statusCode = error?.statusCode || error?.status || 500;
  if (statusCode >= 500) console.error("API request failed:", error);
  sendJson(res, statusCode, {
    error: error.type === "entity.parse.failed" ? "The request contains invalid JSON."
      : statusCode >= 500 ? "Something went wrong. Please try again."
        : error instanceof Error ? error.message : "Request failed.",
  });
});

export async function start(port = PORT) {
  await ensureStorage();
  await readCatalog();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}
