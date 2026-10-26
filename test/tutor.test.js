import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { LIMITS_PAGES } from "./pdf-fixture.js";

const testRoot = await mkdtemp(join(tmpdir(), "professor-"));
const dataDir = join(testRoot, ".professorai-data");
process.env.PROFESSORAI_DATA_DIR = dataDir;
for (const key of ["XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "TUTOR_MODEL", "XAI_MODEL"]) {
  delete process.env[key];
}

const { inferTitle } = await import("../server/lib/text.js");
const { heuristicSyllabus, listLessons } = await import("../server/lib/tutor.js");
const { modelCatalog, resolveModelId } = await import("../server/lib/models.js");
const { languageModel } = await import("../server/lib/ai.js");
const { start } = await import("../server/app.js");
const { buildSimplePdf: buildPdf } = await import("./pdf-fixture.js");

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(testRoot, { recursive: true, force: true });
});

describe("tutor", { concurrency: 1 }, () => {
  test("names a lesson from a short heading", () => {
    assert.equal(inferTitle("Limits\n\nThe limit of f(x) as x approaches a is L.", "Lesson"), "Limits");
  });

  test("builds a progressive path from readable pages without a model", () => {
    const syllabus = heuristicSyllabus([
      {
        id: "doc-1",
        name: "Calculus notes",
        status: "ready",
        pageUnit: "page",
        pages: LIMITS_PAGES.map((page, index) => ({
          number: index + 1,
          text: `${page.title}\n\n${page.body}`,
        })),
      },
    ]);
    const lessons = listLessons(syllabus);
    assert.deepEqual(
      lessons.map((lesson) => lesson.title),
      ["Limits", "Limit laws", "Continuity"],
    );
    assert.equal(lessons[0].sourceRefs[0].page, 1);
    assert.equal(lessons[2].sourceRefs[0].page, 3);
  });

  test("resolves a provider model through the AI SDK registry", () => {
    const model = languageModel("openai:gpt-5.4");
    assert.match(model.provider, /^openai/);
    assert.equal(model.modelId, "gpt-5.4");
    const grok = languageModel("anthropic:claude-sonnet-5-5");
    assert.match(grok.provider, /^anthropic/);
    assert.equal(grok.modelId, "claude-sonnet-5-5");
    assert.equal(resolveModelId(""), "");
    assert.equal(modelCatalog("").live, false);
  });

  test("switches the active model only when that provider is configured", async () => {
    const blocked = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "openai:gpt-5.4" }),
    });
    assert.equal(blocked.status, 400);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.XAI_API_KEY = "test-key";
    try {
      const saved = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: "openai:gpt-5.4" }),
      }).then((response) => response.json());
      assert.equal(saved.selected, "openai:gpt-5.4");
      assert.equal(saved.selectedLabel, "GPT-5.4");
      assert.equal(saved.providers.find((provider) => provider.id === "xai").configured, true);
      assert.equal(saved.providers.find((provider) => provider.id === "anthropic").configured, false);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.XAI_API_KEY;
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: "openai:gpt-5.4" }),
      });
    }
  });

  test("turns an uploaded PDF into a lesson that can pause for a question and resume", async () => {
    const form = new FormData();
    form.append("materials", new Blob([buildPdf(LIMITS_PAGES)], { type: "application/pdf" }), "limits.pdf");
    form.append("name", "Maya");
    form.append("background", "I know algebra, and limit notation is new.");
    form.append("style", "intuition");
    form.append("pace", "steady");

    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    assert.equal(created.course.status, "building");

    let course = created.course;
    for (let attempt = 0; attempt < 25 && course.status === "building"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      course = await fetch(`${base}/api/courses/${created.course.id}`).then((response) => response.json()).then((payload) => payload.course);
    }

    assert.equal(course.status, "ready", course.error);
    const lessons = listLessons(course.syllabus);
    assert.ok(lessons.length >= 3, `expected at least 3 lessons, got ${lessons.map((lesson) => lesson.title).join(", ")}`);
    assert.match(lessons[0].title, /Limit/i);

    const script = await fetch(`${base}/api/courses/${course.id}/lessons/${lessons[0].id}/script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((response) => response.json());
    assert.ok(script.beats.length >= 3);
    assert.ok(script.beats.some((beat) => beat.kind === "check"));
    assert.equal(script.source, "notes");

    const progress = await fetch(`${base}/api/courses/${course.id}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: lessons[0].id,
        beatIndex: 1,
        completedLessonIds: [],
        paused: true,
      }),
    }).then((response) => response.json());
    assert.equal(progress.progress.beatIndex, 1);
    assert.equal(progress.progress.paused, true);

    const completed = await fetch(`${base}/api/courses/${course.id}/progress`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedLessonIds: [lessons[0].id, lessons[0].id, "unknown"] }),
    }).then((response) => response.json());
    assert.deepEqual(completed.progress.completedLessonIds, [lessons[0].id]);
    assert.equal(completed.progress.beatIndex, 1);
    assert.equal(completed.progress.paused, true);

    const partial = await fetch(`${base}/api/courses/${course.id}/progress`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}",
    }).then((response) => response.json());
    assert.deepEqual(partial.progress.completedLessonIds, [lessons[0].id]);

    const answer = await fetch(`${base}/api/courses/${course.id}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: lessons[0].id,
        beatIndex: 1,
        mode: "interrupt",
        question: "What does it mean for x to get close to a?",
      }),
    });
    assert.match(answer.headers.get("content-type"), /text\/event-stream/);
    assert.equal(answer.headers.get("x-accel-buffering"), "no");
    assert.equal(answer.headers.get("content-encoding"), null);
    const body = await answer.text();
    assert.match(body, /event: delta/);
    assert.match(body, /event: done/);
    assert.match(body, /close|limit|pause/i);

    const reloaded = await fetch(`${base}/api/courses/${course.id}`).then((response) => response.json());
    assert.equal(reloaded.course.progress.lessonId, lessons[0].id);
    assert.equal(reloaded.course.progress.paused, true);
  });

  test("names the course and keeps a written page chat on the server", async () => {
    const form = new FormData();
    form.append("materials", new Blob([buildPdf(LIMITS_PAGES)], { type: "application/pdf" }), "limits.pdf");
    form.append("title", "Limits with Maya");
    form.append("name", "Maya");

    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    assert.equal(created.course.title, "Limits with Maya");

    const pages = await fetch(`${base}/api/courses/${created.course.id}/pages`).then((response) => response.json());
    assert.ok(pages.pages.length >= 3);
    const first = pages.pages[0];
    const second = pages.pages[1];

    const explained = await fetch(`${base}/api/courses/${created.course.id}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: first.documentId, page: first.number }),
    });
    const explanation = await explained.text();
    assert.match(explanation, /event: done/);
    assert.match(explanation, /page|limit/i);

    const asked = await fetch(`${base}/api/courses/${created.course.id}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: first.documentId,
        page: first.number,
        question: "What does it mean for x to get close to a?",
      }),
    });
    const answer = await asked.text();
    assert.match(answer, /event: done/);

    await fetch(`${base}/api/courses/${created.course.id}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: second.documentId, page: second.number }),
    });

    let saved = await fetch(`${base}/api/courses/${created.course.id}`).then((response) => response.json());
    for (let attempt = 0; attempt < 25 && saved.course.status === "building"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      saved = await fetch(`${base}/api/courses/${created.course.id}`).then((response) => response.json());
    }
    assert.equal(saved.course.title, "Limits with Maya");
    const chat = saved.course.chat;
    assert.equal(chat.filter((message) => message.kind === "explain" && message.page === first.number).length, 1);
    assert.equal(chat.filter((message) => message.kind === "explain" && message.page === second.number).length, 1);
    assert.ok(chat.some((message) => message.role === "student" && message.page === first.number));
    assert.ok(chat.some((message) => message.kind === "answer" && message.page === first.number));
    assert.equal(saved.course.progress.page.number, second.number);
  });

  test("returns clear errors for malformed JSON and missing courses", async () => {
    const malformed = await fetch(`${base}/api/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{broken",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "The request contains invalid JSON.");
    const missing = await fetch(`${base}/api/courses/missing`);
    assert.equal(missing.status, 404);
  });

  test("reports notes-only mode when Grok has no configured key", async () => {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    const models = await fetch(`${base}/api/models`).then((response) => response.json());
    assert.equal(health.tutor, "notes");
    assert.equal(models.live, false);
    assert.equal(models.providers.find((provider) => provider.id === "xai").configured, false);
  });

  test("stores editable course memory and controls cross-page question context", async () => {
    const form = new FormData();
    form.append("materials", new Blob([buildPdf(LIMITS_PAGES)], { type: "application/pdf" }), "limits.pdf");
    form.append("name", "Maya");
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const url = `${base}/api/courses/${created.course.id}`;
    const patch = (body) => fetch(`${url}/learner`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let result = await patch({ background: "I know algebra", memory: "Explain notation slowly", useRecentQuestions: false });
    assert.equal(result.status, 200);
    let course = (await result.json()).course;
    assert.equal(course.learner.name, "Maya");
    assert.equal(course.learner.memory, "Explain notation slowly");
    assert.equal(course.learner.useRecentQuestions, false);
    assert.equal((await patch({ memory: "x".repeat(1201) })).status, 400);
    assert.equal((await patch({ useRecentQuestions: "yes" })).status, 400);
    const { pages } = await fetch(`${url}/pages`).then((response) => response.json());
    const ask = (page, question) => fetch(`${url}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: page.documentId, page: page.number, question }) }).then((response) => response.text());
    await ask(pages[0], "What does a limit mean?");
    await ask(pages[1], "How does this law work?");
    const { readCatalog } = await import("../server/lib/store.js");
    const { recentQuestionsOf } = await import("../server/lib/pages.js");
    course = (await readCatalog()).courses.find((item) => item.id === created.course.id);
    assert.deepEqual(recentQuestionsOf(course, pages[1]), []);
    await patch({ useRecentQuestions: true });
    course = (await readCatalog()).courses.find((item) => item.id === created.course.id);
    assert.deepEqual(recentQuestionsOf(course, pages[1]).map((item) => item.text), ["What does a limit mean?"]);
    await fetch(`${url}/documents/${pages[0].documentId}/pages/1/chat`, { method: "DELETE" });
    course = (await readCatalog()).courses.find((item) => item.id === created.course.id);
    assert.deepEqual(recentQuestionsOf(course, pages[1]), []);
    result = await patch({ memory: "" });
    assert.equal((await result.json()).course.learner.memory, "");
    course = (await fetch(url).then((response) => response.json())).course;
    assert.equal(course.learner.background, "I know algebra");
    assert.equal(course.learner.useRecentQuestions, true);
  });

  test("reports a live tutor failure instead of silently using notes", async () => {
    const { streamPageAnswer } = await import("../server/lib/tutor.js");
    const originalError = console.error;
    console.error = () => {};
    try {
      const deltas = [];
      await assert.rejects(streamPageAnswer({ question: "What is a limit?", page: { label: "page 1", text: "A limit describes an approaching value." }, learner: {}, history: [], live: true, modelId: "missing-provider:model" }, (delta) => deltas.push(delta)), /could not respond/);
      assert.deepEqual(deltas, []);
    } finally {
      console.error = originalError;
    }
  });

  test("only sends an explicitly included page image and does not store it", async () => {
    const form = new FormData();
    form.append("materials", new Blob([buildPdf([LIMITS_PAGES[0], { title: "", body: "" }])], { type: "application/pdf" }), "image-page.pdf");
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const url = `${base}/api/courses/${created.course.id}`;
    let course;
    do { course = (await fetch(url).then((response) => response.json())).course; if (course.status === "building") await new Promise((resolve) => setTimeout(resolve, 20)); } while (course.status === "building");
    const { pages } = await fetch(`${url}/pages`).then((response) => response.json());
    const body = { documentId: pages[1].documentId, page: 2, question: "What is shown?" };
    const post = (payload) => fetch(`${url}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal((await post(body)).status, 422);
    const image = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(30, 1), Buffer.from([0xff, 0xd9])]).toString('base64')}`;
    assert.equal((await post({ ...body, pageImage: image })).status, 400);
    const originalFetch = globalThis.fetch;
    const priorKey = process.env.XAI_API_KEY;
    const requests = [];
    process.env.XAI_API_KEY = "test-key";
    globalThis.fetch = async (request, init) => {
      if (!String(request).startsWith("https://api.x.ai/")) return originalFetch(request, init);
      requests.push(JSON.parse(init.body));
      const events = [
        { id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { content: "I can see the page." }, finish_reason: null }] },
        { id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    };
    try {
      assert.equal((await post({ ...body, pageImage: "data:image/jpeg;base64,bad" })).status, 400);
      assert.equal((await post({ ...body, pageImage: `data:image/jpeg;base64,${'A'.repeat(800000)}` })).status, 400);
      const response = await post({ ...body, pageImage: image });
      assert.match(await response.text(), /event: done/);
      const content = requests[0].messages.find((message) => message.role === "user").content;
      assert.ok(content.some((item) => item.type === "image_url" && item.image_url.url === image));
      course = (await fetch(url).then((value) => value.json())).course;
      assert.equal(course.chat.find((message) => message.role === "student").usedPageImage, true);
      const catalog = await import('node:fs/promises').then(({ readFile }) => readFile(join(dataDir, 'catalog.json'), 'utf8'));
      assert.equal(catalog.includes(image), false);
      assert.equal((await post(body)).status, 422);
      const explain = (payload) => fetch(`${url}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      assert.equal((await explain(body)).status, 422);
      const explained = await explain({ ...body, pageImage: image });
      assert.match(await explained.text(), /event: done/);
      const reopenedPage = (await fetch(`${url}/pages`).then((value) => value.json())).pages[1];
      assert.equal(reopenedPage.explained, true);
      assert.equal(reopenedPage.explanationUsedPageImage, true);
      const cached = await explain(body);
      assert.match(await cached.text(), /"usedPageImage":true/);
      assert.equal(requests.length, 2);
      const persisted = await import('node:fs/promises').then(({ readFile }) => readFile(join(dataDir, 'catalog.json'), 'utf8'));
      assert.equal(persisted.includes(image), false);
    } finally {
      globalThis.fetch = originalFetch;
      if (priorKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = priorKey;
    }
  });

  test("resets one page chat and its cached explanation without clearing other pages", async () => {
    const form = new FormData();
    for (const name of ["first.pdf", "second.pdf"]) form.append("materials", new Blob([buildPdf(LIMITS_PAGES)], { type: "application/pdf" }), name);
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const url = `${base}/api/courses/${created.course.id}`;
    const { pages } = await fetch(`${url}/pages`).then((response) => response.json());
    const targets = [pages[0], pages[1], pages[3]];
    const post = (path, body) => fetch(`${url}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    for (const page of targets) await post("explain", { documentId: page.documentId, page: page.number }).then((response) => response.text());
    await post("ask", { documentId: pages[0].documentId, page: 1, question: "Explain approaching a value." }).then((response) => response.text());
    let detail = (await fetch(url).then((response) => response.json())).course;
    assert.equal(detail.totalPages, 6);
    assert.equal(detail.taughtPages, 3);
    assert.deepEqual(detail.documents.map((document) => document.taughtPages), [2, 1]);

    const resetUrl = `${url}/documents/${pages[0].documentId}/pages/1/chat`;
    const reset = await fetch(resetUrl, { method: "DELETE" }).then((response) => response.json());
    assert.equal(reset.page.chatRevision, 1);
    assert.equal(reset.page.autoExplain, false);
    assert.equal(reset.page.explained, false);
    assert.equal(reset.page.explanation, "");
    assert.equal(reset.course.taughtPages, 2);
    assert.deepEqual(reset.course.documents.map((document) => document.taughtPages), [1, 1]);
    assert.equal(reset.course.chat.some((message) => message.documentId === pages[0].documentId && message.page === 1), false);
    assert.ok(reset.course.chat.some((message) => message.documentId === pages[1].documentId && message.page === 2));
    assert.ok(reset.course.chat.some((message) => message.documentId === pages[3].documentId && message.page === 1));

    const reopened = await fetch(`${url}/pages`).then((response) => response.json());
    assert.equal(reopened.pages[0].autoExplain, false);
    assert.equal(reopened.pages[0].explained, false);
    for (const path of ["explain", "ask"]) {
      const stale = await post(path, { documentId: pages[0].documentId, page: 1, chatRevision: 0, question: "Old question" });
      assert.equal(stale.status, 409);
    }
    const fresh = await post("explain", { documentId: pages[0].documentId, page: 1, chatRevision: 1 });
    assert.match(await fresh.text(), /event: delta/);
    detail = (await fetch(url).then((response) => response.json())).course;
    assert.equal(detail.taughtPages, 3);
    const counts = (await fetch(`${base}/api/courses`).then((response) => response.json())).courses.find((course) => course.id === detail.id);
    assert.equal(counts.taughtPages, 3);
    assert.equal(counts.totalPages, 6);
    const { readFile } = await import("node:fs/promises");
    const persisted = JSON.parse(await readFile(join(dataDir, "catalog.json"), "utf8")).courses.find((course) => course.id === detail.id);
    assert.equal(persisted.pageChatResets[`${pages[0].documentId}:1`].revision, 1);
    assert.equal((await fetch(`${url}/documents/missing/pages/1/chat`, { method: "DELETE" })).status, 404);
  });

  test("renames a course durably and rejects invalid names", async () => {
    const form = new FormData();
    form.append("materials", new Blob(["Mathematics\n\nProofs explain why a claim is true."]), "mit6_042js15_textbook2.txt");
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const url = `${base}/api/courses/${created.course.id}`;
    for (const title of ["", "  ", 123, {}, "x".repeat(81), "Bad\nname"]) {
      const invalid = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      assert.equal(invalid.status, 400);
    }
    const renamed = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "  Mathematics for Computer Science  " }) }).then((response) => response.json());
    assert.equal(renamed.course.title, "Mathematics for Computer Science");
    assert.equal(renamed.course.documents[0].originalName, "mit6_042js15_textbook2.txt");
    const listed = await fetch(`${base}/api/courses`).then((response) => response.json());
    assert.equal(listed.courses.find((item) => item.id === created.course.id).title, renamed.course.title);
    const { readFile } = await import("node:fs/promises");
    const persisted = JSON.parse(await readFile(join(dataDir, "catalog.json"), "utf8"));
    assert.equal(persisted.courses.find((item) => item.id === created.course.id).title, renamed.course.title);
    const missing = await fetch(`${base}/api/courses/missing`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Course" }) });
    assert.equal(missing.status, 404);
  });

  test("preserves original PDF page numbering and explanations beyond chat retention", async () => {
    const form = new FormData();
    form.append("materials", new Blob([buildPdf([LIMITS_PAGES[0], { title: "", body: "" }, LIMITS_PAGES[2]])], { type: "application/pdf" }), "with-blank-page.pdf");
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const url = `${base}/api/courses/${created.course.id}`;
    let { pages } = await fetch(`${url}/pages`).then((response) => response.json());
    assert.deepEqual(pages.map((page) => page.number), [1, 2, 3]);
    assert.equal(pages[1].canExplain, false);
    assert.equal(pages[1].isPdf, true);
    assert.equal(pages[1].explained, false);
    const documentId = pages[0].documentId;
    const original = await fetch(`${url}/documents/${documentId}/file`, { headers: { Range: "bytes=0-15" } });
    assert.equal(original.status, 206);
    assert.match(await original.text(), /^%PDF/);
    const blank = await fetch(`${url}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, page: 2 }) });
    assert.equal(blank.status, 422);
    const explain = () => fetch(`${url}/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId, page: 1 }) }).then((response) => response.text());
    assert.match(await explain(), /event: delta/);
    const { updateCatalog } = await import("../server/lib/store.js");
    await updateCatalog((catalog) => { catalog.courses.find((item) => item.id === created.course.id).chat = []; });
    ({ pages } = await fetch(`${url}/pages`).then((response) => response.json()));
    assert.equal(pages[0].explained, true);
    assert.match(pages[0].explanation, /Limits/);
    assert.ok(pages[0].explainedAt);
    assert.equal(pages[2].explained, false);
    const cached = await explain();
    assert.match(cached, /event: done/);
    assert.doesNotMatch(cached, /event: delta/);
    const detail = await fetch(url).then((response) => response.json());
    assert.equal(detail.course.explainedPages.filter((page) => page.documentId === documentId && page.page === 1).length, 1);
    const progress = await fetch(`${url}/progress`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: { documentId, number: 2 } }) }).then((response) => response.json());
    assert.equal(progress.progress.page.number, 2);
  });

  test("serves Unicode filenames safely and reports missing original files", async () => {
    const form = new FormData();
    form.append("materials", new Blob(["Limits\n\nA limit describes a value approached by a function."]), "notes.txt");
    const created = await fetch(`${base}/api/courses`, { method: "POST", body: form }).then((response) => response.json());
    const { readCatalog, updateCatalog, UPLOAD_DIR } = await import("../server/lib/store.js");
    await updateCatalog((catalog) => {
      const course = catalog.courses.find((item) => item.id === created.course.id);
      course.documents[0].originalName = "数学 notes.txt";
    });
    const document = (await readCatalog()).courses.find((item) => item.id === created.course.id).documents[0];
    const url = `${base}/api/courses/${created.course.id}/documents/${document.id}/file`;
    const downloaded = await fetch(url);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /filename\*=/);
    assert.match(await downloaded.text(), /A limit/);
    await rm(join(UPLOAD_DIR, document.storageName));
    const missing = await fetch(url);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /no longer available/);
  });
});
