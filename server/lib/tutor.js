import { z } from "zod";
import { completeObject, streamReply } from "./ai.js";
import {
  clampText,
  condenseWords,
  excerptText,
  inferTitle,
  keywords,
  limitWords,
  overlapScore,
  splitSentences,
  withoutHeading,
} from "./text.js";

const STYLES = {
  examples: "Teach with a concrete example before the abstraction. Use situations the learner can picture.",
  intuition: "Lead with why the idea exists and the mental picture. Define a term only when it becomes necessary.",
  precise: "Be formally precise. Name the definition, the conditions, and one common mistake. Keep examples short.",
};

const PACES = {
  steady: "Use shorter steps and restate the idea before moving on.",
  brisk: "Keep the narration tight. Assume the previous idea is still in mind, and still include one check.",
};

export function normalizeLearner(input = {}) {
  const style = STYLES[input.style] ? input.style : "examples";
  const pace = PACES[input.pace] ? input.pace : "steady";
  return {
    name: limitWords(input.name, 4).slice(0, 40),
    background: limitWords(input.background, 80),
    style,
    pace,
  };
}

export function learnerKey(learner) {
  const normalized = normalizeLearner(learner);
  return JSON.stringify(normalized);
}

export function listLessons(syllabus) {
  const lessons = [];
  for (const module of syllabus?.modules || []) {
    for (const lesson of module.lessons || []) {
      lessons.push({ ...lesson, moduleId: module.id, moduleTitle: module.title });
    }
  }
  return lessons;
}

export function lessonContext(syllabus, lessonId) {
  const lessons = listLessons(syllabus);
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  return {
    lesson: index >= 0 ? lessons[index] : null,
    previous: index > 0 ? lessons[index - 1] : null,
    next: index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : null,
    index,
    total: lessons.length,
  };
}

function styleLine(learner) {
  return STYLES[learner?.style] || STYLES.examples;
}

function paceLine(learner) {
  return PACES[learner?.pace] || PACES.steady;
}

function learnerBlock(learner) {
  const normalized = normalizeLearner(learner);
  return [
    normalized.name ? `Student name: ${normalized.name}` : "The student has not given a name.",
    normalized.background ? `What they already know: ${normalized.background}` : "No background was given. Do not assume a specialist vocabulary.",
    `Teaching style: ${styleLine(normalized)}`,
    `Pacing: ${paceLine(normalized)}`,
  ].join("\n");
}

function usablePages(document) {
  return (document.pages || []).filter((page) => page.text && !page.text.startsWith("[No extractable text"));
}

export function buildDigest(documents) {
  const entries = [];
  for (const document of documents) {
    for (const page of usablePages(document)) {
      entries.push({
        documentId: document.id,
        documentName: document.name,
        page: page.number,
        unit: document.pageUnit || "page",
        text: page.text.trim(),
      });
    }
  }

  const budget = 28000;
  const full = entries
    .map((entry) => formatDigestEntry(entry, 900))
    .join("\n\n");
  if (full.length <= budget) return full;

  const must = new Set();
  entries.forEach((entry, index) => {
    if (index === 0 || index === entries.length - 1) must.add(index);
    if (entry.text.length < 280) must.add(index);
    if (/\b(chapter|lecture|week|module|objective|syllabus|overview)\b/i.test(entry.text.slice(0, 180))) must.add(index);
  });

  const chosen = [];
  let used = 0;
  const tryAdd = (index) => {
    if (chosen.includes(index)) return;
    const block = formatDigestEntry(entries[index], 420);
    if (used + block.length > budget) return;
    chosen.push(index);
    used += block.length + 2;
  };

  for (const index of must) tryAdd(index);
  const stride = Math.max(1, Math.ceil(entries.length / 40));
  for (let index = 0; index < entries.length; index += stride) tryAdd(index);
  for (let index = 0; index < entries.length; index += 1) tryAdd(index);

  chosen.sort((a, b) => a - b);
  return chosen.map((index) => formatDigestEntry(entries[index], 420)).join("\n\n");
}

function formatDigestEntry(entry, maxChars) {
  return `[${entry.documentName} | id:${entry.documentId} | ${entry.unit} ${entry.page}]\n${excerptText(entry.text, maxChars)}`;
}

function pagesPerLesson(pageCount) {
  if (pageCount <= 4) return 1;
  if (pageCount <= 10) return 2;
  if (pageCount <= 20) return 3;
  return Math.ceil(pageCount / 12);
}

function lessonObjective(text, title) {
  const lines = String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bodyLines = lines[0]?.toLowerCase() === String(title).toLowerCase() ? lines.slice(1) : lines;
  const sentences = splitSentences(bodyLines.join(" "));
  const body = sentences.find((sentence) => sentence.length > 40) || sentences[0] || "";
  if (!body) return `Understand ${title}.`;
  return condenseWords(body, 28);
}

export function heuristicSyllabus(documents) {
  const ready = documents.filter((document) => usablePages(document).length);
  if (!ready.length) {
    throw new Error("No readable text was found. If this is a scanned PDF, export a text-based PDF and upload that.");
  }

  const pages = ready.flatMap((document) =>
    usablePages(document).map((page) => ({
      documentId: document.id,
      documentName: document.name,
      page: page.number,
      text: page.text,
    })),
  );

  const size = pagesPerLesson(pages.length);
  const groups = [];
  for (let index = 0; index < pages.length; index += size) {
    groups.push(pages.slice(index, index + size));
  }

  const lessons = groups.slice(0, 12).map((group, lessonIndex) => {
    const text = group.map((page) => page.text).join("\n\n");
    const title = inferTitle(text, `Lesson ${lessonIndex + 1}`);
    return {
      title,
      objective: lessonObjective(text, title),
      minutes: Math.min(8, 4 + Math.min(group.length, 3)),
      concepts: splitSentences(text)
        .slice(0, 3)
        .map((sentence) => clampText(sentence, 80)),
      sources: groupSources(group),
    };
  });

  const moduleSize = lessons.length > 4 ? 3 : lessons.length;
  const modules = [];
  for (let index = 0; index < lessons.length; index += moduleSize) {
    const slice = lessons.slice(index, index + moduleSize);
    modules.push({
      title: modules.length === 0 && lessons.length <= 4 ? "The path" : slice[0].title,
      summary: slice[0].objective,
      lessons: slice,
    });
  }

  const title =
    ready.length === 1
      ? ready[0].name
      : `${ready[0].name} and ${ready.length - 1} more`;

  return normalizeSyllabus(
    {
      title,
      promise: `A guided path through ${title}, one idea at a time.`,
      modules,
    },
    documents,
  );
}

function groupSources(group) {
  const byDocument = new Map();
  for (const page of group) {
    const pages = byDocument.get(page.documentId) || [];
    pages.push(page.page);
    byDocument.set(page.documentId, pages);
  }
  return [...byDocument.entries()].map(([documentId, pageNumbers]) => ({
    documentId,
    pages: pageNumbers,
  }));
}

export function normalizeSyllabus(raw, documents) {
  const documentIds = new Set(documents.map((document) => document.id));
  const modules = Array.isArray(raw?.modules) ? raw.modules : [];
  const normalizedModules = [];

  modules.forEach((module, moduleIndex) => {
    const lessons = [];
    const sourceLessons = Array.isArray(module?.lessons) ? module.lessons : [];
    sourceLessons.forEach((lesson) => {
      const title = clampText(lesson?.title, 90);
      if (!title) return;
      const sourceRefs = normalizeSources(lesson?.sources || lesson?.sourceRefs, documentIds, documents);
      lessons.push({
        id: `m${normalizedModules.length}-l${lessons.length}`,
        title,
        objective: clampText(lesson?.objective, 220) || `Understand ${title}.`,
        minutes: Math.min(12, Math.max(3, Number(lesson?.minutes) || 6)),
        concepts: (Array.isArray(lesson?.concepts) ? lesson.concepts : [])
          .map((concept) => clampText(concept, 80))
          .filter(Boolean)
          .slice(0, 4),
        sourceRefs,
      });
    });

    if (!lessons.length) return;
    normalizedModules.push({
      id: `m${moduleIndex}`,
      title: clampText(module?.title, 80) || `Part ${normalizedModules.length + 1}`,
      summary: clampText(module?.summary, 220) || lessons[0].objective,
      lessons,
    });
  });

  normalizedModules.forEach((module, moduleIndex) => {
    module.id = `m${moduleIndex}`;
    module.lessons.forEach((lesson, lessonIndex) => {
      lesson.id = `m${moduleIndex}-l${lessonIndex}`;
    });
  });

  const lessonCount = normalizedModules.reduce((sum, module) => sum + module.lessons.length, 0);
  if (!lessonCount) {
    throw new Error("The tutor could not find a teachable path in this material.");
  }

  const trimmedModules = [];
  let kept = 0;
  for (const module of normalizedModules) {
    if (kept >= 12) break;
    const room = 12 - kept;
    const lessons = module.lessons.slice(0, room);
    kept += lessons.length;
    trimmedModules.push({ ...module, lessons });
  }

  return {
    title: clampText(raw?.title, 90) || documents[0]?.name || "Course",
    promise: clampText(raw?.promise, 220) || "A guided path through your materials, one idea at a time.",
    modules: trimmedModules,
  };
}

function normalizeSources(sources, documentIds, documents) {
  const refs = [];
  const seen = new Set();
  const list = Array.isArray(sources) ? sources : [];

  for (const source of list) {
    const documentId = documentIds.has(source?.documentId) ? source.documentId : documents[0]?.id;
    const pages = Array.isArray(source?.pages)
      ? source.pages
      : source?.page
        ? [source.page]
        : [];
    for (const page of pages) {
      const number = Number(page);
      if (!documentId || !Number.isInteger(number) || number < 1) continue;
      const key = `${documentId}:${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ documentId, page: number });
    }
  }

  if (!refs.length && documents[0]) {
    const first = usablePages(documents[0])[0];
    if (first) refs.push({ documentId: documents[0].id, page: first.number });
  }

  return refs.slice(0, 8);
}

function syllabusMessages(documents, learner) {
  return [
    {
      role: "system",
      content:
        "You are an exceptional tutor designing a course from a student's own materials. " +
        "Read the digested pages and arrange a path that teaches the subject in a logical, progressive order. " +
        "Respect the source. Do not invent topics that are not supported by the material. " +
        "Return only JSON.",
    },
    {
      role: "user",
      content: [
        learnerBlock(learner),
        "",
        "Material digest:",
        buildDigest(documents),
        "",
        `Return JSON with this shape:
{
  "title": string,
  "promise": string,
  "modules": [
    {
      "title": string,
      "summary": string,
      "lessons": [
        {
          "title": string,
          "objective": string,
          "minutes": number,
          "concepts": string[],
          "sources": [{ "documentId": string, "pages": number[] }]
        }
      ]
    }
  ]
}`,
        "Rules:",
        "- Follow the source order when the source is already well sequenced.",
        "- Merge pages that teach one idea. Split a page that contains several ideas.",
        "- Every lesson must cite real documentId values and page numbers from the digest.",
        "- Prefer 4 to 10 lessons. For a very short text, 2 to 4 is enough. Never more than 12.",
        "- Titles should name the idea, not the page number.",
        "- promise is one sentence spoken to the student about what they will be able to do.",
        "- objective is one sentence. concepts are 2 to 4 short phrases.",
        "- minutes is an integer from 4 to 8.",
      ].join("\n"),
    },
  ];
}

const syllabusSchema = z.object({
  title: z.string(),
  promise: z.string(),
  modules: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      lessons: z.array(
        z.object({
          title: z.string(),
          objective: z.string(),
          minutes: z.coerce.number(),
          concepts: z.array(z.string()).optional(),
          sources: z.array(
            z.object({
              documentId: z.string(),
              pages: z.array(z.coerce.number()),
            }),
          ),
        }),
      ),
    }),
  ),
});

const scriptSchema = z.object({
  beats: z.array(
    z.object({
      kind: z.enum(["teach", "example", "check", "close"]),
      eyebrow: z.string(),
      headline: z.string(),
      narration: z.string(),
      board: z.array(z.string()).optional(),
      hint: z.string().optional(),
      lookFor: z.string().optional(),
    }),
  ),
});

export async function createSyllabus({ documents, learner, live, modelId }) {
  if (live && modelId) {
    try {
      const raw = await completeObject({
        schema: syllabusSchema,
        messages: syllabusMessages(documents, learner),
        modelId,
        maxOutputTokens: 3500,
        temperature: 0.3,
        timeoutMs: 90000,
      });
      return { syllabus: normalizeSyllabus(raw, documents), tutorMode: "live", modelId };
    } catch (error) {
      console.error("Syllabus generation used the notes path:", error instanceof Error ? error.message : error);
    }
  }

  return { syllabus: heuristicSyllabus(documents), tutorMode: "notes", modelId: "" };
}

export function pagesForLesson(documents, lesson) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const pages = [];
  for (const ref of lesson?.sourceRefs || []) {
    const document = byId.get(ref.documentId);
    const page = document?.pages?.find((item) => item.number === ref.page);
    if (!page?.text || page.text.startsWith("[No extractable text")) continue;
    pages.push({
      documentId: document.id,
      documentName: document.name,
      page: page.number,
      unit: document.pageUnit || "page",
      text: page.text,
    });
  }
  return pages;
}

function sourceBlock(pages, maxChars = 7000) {
  let used = 0;
  const blocks = [];
  for (const page of pages) {
    const excerpt = page.text.trim();
    if (!excerpt || used >= maxChars) continue;
    const slice = excerpt.slice(0, Math.max(0, maxChars - used));
    used += slice.length;
    blocks.push(`[${page.documentName}, ${page.unit} ${page.page}]\n${slice}`);
  }
  return blocks.join("\n\n");
}

export function heuristicScript({ lesson, pages, learner, previous, next }) {
  const paragraphs = pages
    .flatMap((page) => page.text.split(/\n+/))
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 40);
  const idea = paragraphs[0] || lesson.objective || lesson.title;
  const support = paragraphs[1] || "";
  const illustration = paragraphs[2] || paragraphs[1] || idea;
  const name = normalizeLearner(learner).name;
  const opening = name
    ? `${name}, let's take ${lesson.title}. ${condenseWords(idea, 70)}`
    : `Let's take ${lesson.title}. ${condenseWords(idea, 75)}`;

  const beats = [
    {
      kind: "teach",
      eyebrow: "The idea",
      headline: lesson.title,
      narration: opening,
      board: splitSentences(idea)
        .slice(0, 3)
        .map((sentence) => clampText(sentence, 110)),
    },
  ];

  if (support && support !== idea) {
    beats.push({
      kind: "teach",
      eyebrow: previous ? `After ${previous.title}` : "A little further",
      headline: inferTitle(support, "Why it works"),
      narration: condenseWords(support, 80),
      board: splitSentences(support)
        .slice(0, 3)
        .map((sentence) => clampText(sentence, 110)),
    });
  }

  beats.push({
    kind: "example",
    eyebrow: "See it",
    headline: "How this shows up",
    narration: `Here is the idea in the form your notes actually use. ${condenseWords(illustration, 70)}`,
    board: splitSentences(illustration)
      .slice(0, 3)
      .map((sentence) => clampText(sentence, 110)),
  });

  beats.push({
    kind: "check",
    eyebrow: "Your turn",
    headline: "Say it back",
    narration: `Without looking back, what is the main claim of ${lesson.title}? Answer in a sentence or two.`,
    board: [],
    hint: "Use the words you would use with a classmate, then check them against the definition in the notes.",
    lookFor: condenseWords(idea, 40),
  });

  const landing = next ? `Next we will use this when we look at ${next.title}.` : "That is the last idea on this path.";
  beats.push({
    kind: "close",
    eyebrow: "Carry this",
    headline: lesson.title,
    narration: `Hold onto this: ${condenseWords(idea, 35)} ${landing}`,
    board: [clampText(lesson.objective || idea, 120)],
  });

  return normalizeScript({ beats }, lesson);
}

export function normalizeScript(raw, lesson) {
  const beats = (Array.isArray(raw?.beats) ? raw.beats : [])
    .map((beat) => {
      const kind = ["teach", "example", "check", "close"].includes(beat?.kind) ? beat.kind : "teach";
      return {
        id: "",
        kind,
        eyebrow: clampText(beat?.eyebrow, 40) || (kind === "check" ? "Your turn" : "Lesson"),
        headline: clampText(beat?.headline, 90) || lesson.title,
        narration: clampText(beat?.narration, 900),
        board: (Array.isArray(beat?.board) ? beat.board : [])
          .map((item) => clampText(item, 140))
          .filter(Boolean)
          .slice(0, 4),
        hint: clampText(beat?.hint, 220),
        lookFor: clampText(beat?.lookFor, 280),
      };
    })
    .filter((beat) => beat.narration);

  if (beats.length < 3) {
    throw new Error("The lesson script was too short to teach.");
  }

  const trimmed = beats.slice(0, 8);
  if (!trimmed.some((beat) => beat.kind === "check")) {
    trimmed.splice(Math.max(0, trimmed.length - 1), 0, {
      id: "",
      kind: "check",
      eyebrow: "Your turn",
      headline: "Say it back",
      narration: `In a sentence, what is the point of ${lesson.title}?`,
      board: [],
      hint: lesson.objective,
      lookFor: lesson.objective,
    });
  }
  if (trimmed.at(-1)?.kind !== "close") {
    trimmed.push({
      id: "",
      kind: "close",
      eyebrow: "Carry this",
      headline: lesson.title,
      narration: `The idea to keep is ${lesson.objective}`,
      board: [lesson.objective],
      hint: "",
      lookFor: "",
    });
  }

  return {
    beats: trimmed.slice(0, 8).map((beat, index) => ({ ...beat, id: `b${index}` })),
  };
}

function scriptMessages({ lesson, pages, learner, previous, next, notes }) {
  const callbacks = (notes || [])
    .slice(-3)
    .map((note) => `- During ${note.lessonTitle || "an earlier lesson"}, they asked: ${note.question}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are an exceptional human tutor preparing a spoken lesson from a student's own notes. " +
        "You talk in sentences a person would say aloud. You teach one move at a time. " +
        "You do not use emoji, markdown, or the phrase 'as an AI'. Return only JSON.",
    },
    {
      role: "user",
      content: [
        learnerBlock(learner),
        previous ? `Previous lesson: ${previous.title}. ${previous.objective}` : "This is the first lesson.",
        next ? `The lesson after this one is ${next.title}. You may gesture toward it, but do not teach it.` : "This is the last lesson.",
        callbacks ? `Questions the student has already asked:\n${callbacks}` : "",
        `Lesson title: ${lesson.title}`,
        `Objective: ${lesson.objective}`,
        lesson.concepts?.length ? `Concepts: ${lesson.concepts.join("; ")}` : "",
        "",
        "Source:",
        sourceBlock(pages),
        "",
        `Return JSON:
{
  "beats": [
    {
      "kind": "teach" | "example" | "check" | "close",
      "eyebrow": string,
      "headline": string,
      "narration": string,
      "board": string[],
      "hint": string,
      "lookFor": string
    }
  ]
}`,
        "Rules:",
        "- Use 5 to 7 beats. Begin with teach. Include one example and one check. End with close.",
        "- narration is spoken aloud, 45 to 85 words, with no markdown and no labels.",
        "- Use the student's name at most once in the whole lesson, and only if a name was provided.",
        "- board has 2 to 4 short lines for teach and example, none for check, and 1 to 3 for close.",
        "- The check asks one question. hint nudges without answering. lookFor is a one-sentence private rubric.",
        "- Stay inside the source. A brief analogy must be obviously an analogy.",
        "- Each beat should depend on the one before it.",
        `- ${styleLine(learner)}`,
        `- ${paceLine(learner)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export async function createScript({ documents, syllabus, lesson, learner, notes, live, modelId }) {
  const context = lessonContext(syllabus, lesson.id);
  const pages = pagesForLesson(documents, lesson);
  if (!pages.length) {
    throw new Error("This lesson has no readable source pages.");
  }

  if (live && modelId) {
    try {
      const raw = await completeObject({
        schema: scriptSchema,
        messages: scriptMessages({
          lesson,
          pages,
          learner,
          previous: context.previous,
          next: context.next,
          notes,
        }),
        modelId,
        maxOutputTokens: 2500,
        temperature: 0.6,
        timeoutMs: 70000,
      });
      return {
        ...normalizeScript(raw, lesson),
        source: "live",
        modelId,
        sources: publicSources(pages),
      };
    } catch (error) {
      console.error("Lesson script used the notes path:", error instanceof Error ? error.message : error);
    }
  }

  return {
    ...heuristicScript({
      lesson,
      pages,
      learner,
      previous: context.previous,
      next: context.next,
    }),
    source: "notes",
    modelId: "",
    sources: publicSources(pages),
  };
}

function publicSources(pages) {
  return pages.slice(0, 6).map((page) => ({
    documentId: page.documentId,
    documentName: page.documentName,
    page: page.page,
    unit: page.unit,
    excerpt: excerptText(page.text, 700),
  }));
}

function beatAt(script, beatIndex) {
  return script?.beats?.[beatIndex] || script?.beats?.[0] || null;
}

export function heuristicAnswer({ mode, question, lesson, beat, pages, learner }) {
  const name = normalizeLearner(learner).name;
  const address = name ? `${name}, ` : "";
  const terms = keywords(question);
  const candidates = [
    ...(pages || []).map((page) => withoutHeading(page.text)),
    withoutHeading(beat?.narration || ""),
    withoutHeading(lesson?.objective || ""),
  ];
  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    for (const sentence of splitSentences(candidate)) {
      const score = overlapScore(sentence, terms);
      if (score > bestScore) {
        bestScore = score;
        best = sentence.trim();
      }
    }
  }
  const headline = beat?.headline || lesson?.title || "this idea";
  const grounded = best || condenseWords(beat?.narration || lesson?.objective || "", 35);

  if (mode === "check") {
    const rubricTerms = keywords(`${beat?.lookFor || ""} ${lesson?.objective || ""}`);
    const answerScore = overlapScore(question, rubricTerms);
    const clip = clampText(question, 140);
    if (answerScore >= 2 || (question.trim().length > 35 && answerScore >= 1)) {
      return `${address}you've got hold of it. You said “${clip},” and that lines up with the notes: ${clampText(grounded, 220)} We can keep going.`;
    }
    return `${address}not quite yet. The notes put it this way: ${clampText(beat?.lookFor || grounded, 240)} Hold that version for a moment, then we can continue.`;
  }

  if (!bestScore) {
    return `${address}you paused on “${headline}.” The part of the notes that matters here is this: ${clampText(grounded, 280)} When you come back, we will pick up at ${headline}.`;
  }

  return `${address}you paused on “${headline}.” ${clampText(grounded, 320)} That is the piece of your material closest to what you asked. We will pick the lesson back up at ${headline}.`;
}

function answerMessages({ mode, question, lesson, beat, pages, learner, notes, next }) {
  const recent = (notes || [])
    .slice(-3)
    .map((note) => `- ${note.question}`)
    .join("\n");

  if (mode === "check") {
    return [
      {
        role: "system",
        content:
          "You are an exceptional tutor hearing a student's answer mid-lesson. " +
          "Respond in spoken prose. No greeting, no emoji, no score, no markdown. " +
          "Be specific about what they said.",
      },
      {
        role: "user",
        content: [
          learnerBlock(learner),
          `Lesson: ${lesson.title}`,
          `Objective: ${lesson.objective}`,
          `You asked: ${beat?.narration || ""}`,
          beat?.lookFor ? `A good answer includes: ${beat.lookFor}` : "",
          `The student answered: ${question}`,
          "",
          "Source:",
          sourceBlock(pages, 3500),
          "",
          "Respond in 50 to 110 words. Say whether they have the idea, part of it, or are missing it. Give the missing piece without lecturing. End with a natural sentence about continuing or lingering.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];
  }

  return [
    {
      role: "system",
      content:
        "You are an exceptional tutor. The student paused your lesson to ask something. " +
        "Answer the way a fine human tutor would: direct, warm, and concrete. " +
        "Spoken prose only. No greeting, no emoji, no markdown, and do not say 'great question'.",
    },
    {
      role: "user",
      content: [
        learnerBlock(learner),
        `Lesson: ${lesson.title}`,
        `Objective: ${lesson.objective}`,
        `You were teaching: ${beat?.headline || lesson.title}`,
        `What you had just said: ${beat?.narration || ""}`,
        beat?.board?.length ? `On the board: ${beat.board.join(" | ")}` : "",
        next ? `Later lesson, if they are asking ahead: ${next.title}` : "",
        recent ? `Earlier questions:\n${recent}` : "",
        "",
        "Source for this lesson:",
        sourceBlock(pages, 4000),
        "",
        `Their question: ${question}`,
        "",
        "Answer in 80 to 160 words. Start with the answer itself. Use one concrete detail from the source. If it is outside the materials, say so in one clause. End by naming the board idea you will return to.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export async function streamAnswer(context, onDelta) {
  const { mode, question, documents, syllabus, lesson, beatIndex, script, learner, notes } = context;
  const pages = pagesForLesson(documents, lesson);
  const beat = beatAt(script, beatIndex);
  const next = lessonContext(syllabus, lesson.id).next;
  let streamed = false;

  const push = (delta) => {
    if (!delta) return;
    streamed = true;
    onDelta(delta);
  };

  if (context.live && context.modelId) {
    try {
      const text = await streamReply({
        messages: answerMessages({ mode, question, lesson, beat, pages, learner, notes, next }),
        modelId: context.modelId,
        onDelta: push,
        maxOutputTokens: 700,
        temperature: 0.5,
        timeoutMs: 45000,
      });
      if (text) return text;
    } catch (error) {
      if (streamed) throw error;
      console.error("Answer used the notes path:", error instanceof Error ? error.message : error);
    }
  }

  const fallback = heuristicAnswer({ mode, question, lesson, beat, pages, learner });
  const tokens = fallback.match(/\S+\s*/g) || [fallback];
  for (const token of tokens) push(token);
  return fallback;
}

export function listReadablePages(documents) {
  const pages = [];
  for (const document of documents || []) {
    for (const page of document.pages || []) {
      const text = String(page.text || "").trim();
      if (!text || text.startsWith("[No extractable text")) continue;
      pages.push({
        documentId: document.id,
        documentName: document.originalName || document.name,
        number: page.number,
        label: page.label || `page ${page.number}`,
        unit: document.pageUnit || "page",
        text,
      });
    }
  }
  return pages;
}

function historyBlock(history) {
  return (history || [])
    .slice(-8)
    .map((message) => `${message.role === "student" ? "Student" : "Teacher"} (page ${message.page}): ${clampText(message.text, 400)}`)
    .join("\n");
}

export function heuristicExplanation({ page, learner }) {
  const learnerName = normalizeLearner(learner).name;
  const address = learnerName ? `${learnerName}, ` : "";
  const title = inferTitle(page.text, page.label || "this page");
  const sentences = splitSentences(withoutHeading(page.text)).slice(0, 3);
  const claim = sentences[0] || clampText(withoutHeading(page.text), 240);
  const next = sentences[1] ? ` It goes on: ${sentences[1]}` : "";
  return `${address}this page is ${title}. The page says: ${claim}${next} Read that on the page beside this note. Ask about any line that is unclear. The next page stays put until you move on.`;
}

export function heuristicPageAnswer({ question, page, learner }) {
  const learnerName = normalizeLearner(learner).name;
  const address = learnerName ? `${learnerName}, ` : "";
  const terms = keywords(question);
  if (!terms.length) {
    return `${address}on this page: ${clampText(withoutHeading(page.text), 320)} We stay on this page until you choose the next one.`;
  }
  let best = "";
  let bestScore = 0;
  for (const sentence of splitSentences(withoutHeading(page.text))) {
    const score = overlapScore(sentence, terms);
    if (score > bestScore) {
      bestScore = score;
      best = sentence.trim();
    }
  }
  const grounded = best || clampText(withoutHeading(page.text), 280);
  if (!bestScore) {
    return `${address}that is not spelled out on this page. What the page does say is: ${grounded} We can stay here until that line is clear.`;
  }
  return `${address}${clampText(grounded, 320)} That is the line on this page closest to what you asked. We stay on this page until you choose the next one.`;
}

async function streamProse({ messages, live, modelId, fallback, onDelta }) {
  let streamed = false;
  const push = (delta) => {
    if (!delta) return;
    streamed = true;
    onDelta(delta);
  };
  if (live && modelId) {
    try {
      const text = await streamReply({
        messages,
        modelId,
        onDelta: push,
        maxOutputTokens: 700,
        temperature: 0.4,
        timeoutMs: 45000,
      });
      if (text) return text;
    } catch (error) {
      if (streamed) throw error;
      console.error("Page tutor used the notes path:", error instanceof Error ? error.message : error);
    }
  }
  const tokens = fallback.match(/\S+\s*/g) || [fallback];
  for (const token of tokens) push(token);
  return fallback;
}

export function streamPageExplanation({ page, learner, history, live, modelId }, onDelta) {
  const prior = historyBlock(history);
  return streamProse({
    live,
    modelId,
    fallback: heuristicExplanation({ page, learner }),
    onDelta,
    messages: [
      {
        role: "system",
        content:
          "You are a tutor reading one page of a student's PDF with them. " +
          "Write plain prose they can read next to the page. No greeting, no markdown, no emoji. " +
          "Explain only this page. Do not preview the next page. Do not tell them to continue.",
      },
      {
        role: "user",
        content: [
          learnerBlock(normalizeLearner(learner)),
          prior ? `What you have already discussed:\n${prior}` : "",
          `Page: ${page.label}`,
          "The page text, which they can see:",
          page.text.slice(0, 6000),
          "",
          "Explain this page in 90 to 160 words. Point at the actual sentences. If they struggled earlier, slow down and connect this page to that question. End by inviting a question, not by moving on.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
}

export function streamPageAnswer({ question, page, learner, history, live, modelId }, onDelta) {
  const prior = historyBlock(history);
  return streamProse({
    live,
    modelId,
    fallback: heuristicPageAnswer({ question, page, learner }),
    onDelta,
    messages: [
      {
        role: "system",
        content:
          "You are a tutor sitting with a student on one page of their PDF. " +
          "Answer in written prose. No greeting, no markdown, no emoji, and do not say 'great question'. " +
          "Stay on this page. Do not advance them.",
      },
      {
        role: "user",
        content: [
          learnerBlock(normalizeLearner(learner)),
          prior ? `Conversation so far:\n${prior}` : "",
          `Page: ${page.label}`,
          "Page text:",
          page.text.slice(0, 6000),
          "",
          `Their question: ${question}`,
          "",
          "Answer in 60 to 140 words. Start with the answer. Use a concrete line from this page. If the page does not contain the answer, say so. End on this page, ready for another question or for them to turn the page themselves.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
}
