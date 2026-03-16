import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const XAI_API_KEY = process.env.XAI_API_KEY;
const API_BASE_URL = process.env.XAI_API_BASE_URL || "https://api.x.ai/v1";
const MODEL = process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  const parts = [];

  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

async function handleResponseRequest(req, res) {
  if (!XAI_API_KEY) {
    sendJson(res, 500, {
      error: "Missing XAI_API_KEY. Set it in your shell before starting the server.",
    });
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const {
    mode,
    pageNumber,
    totalPages,
    pageText,
    question,
    studentAnswer,
    pdfName,
    previousPageSummary,
  } = payload;

  if (!mode || !pageNumber || !pageText) {
    sendJson(res, 400, {
      error: "mode, pageNumber, and pageText are required.",
    });
    return;
  }

  const systemPrompt =
    "You are an expert course instructor teaching from lecture notes. " +
    "Stay grounded in the supplied page text and the visible page number. " +
    "If a user asks for something not supported by the page, say that clearly and mark any extra background as outside the notes. " +
    "Keep explanations crisp, use bullets when helpful, and preserve mathematical precision.";

  const userPrompt = [
    `PDF: ${pdfName || "Untitled lecture notes"}`,
    `Current page: ${pageNumber} of ${totalPages || "unknown"}`,
    previousPageSummary ? `Previous page summary: ${previousPageSummary}` : "",
    "Current page text:",
    pageText,
    "",
    "Task:",
    buildTaskPrompt({ mode, question, studentAnswer, pageNumber }),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const apiRes = await fetch(`${API_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
      }),
    });

    const responseJson = await apiRes.json();

    if (!apiRes.ok) {
      sendJson(res, apiRes.status, {
        error: responseJson?.error?.message || "xAI request failed.",
      });
      return;
    }

    const text = extractOutputText(responseJson);
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error.",
    });
  }
}

function buildTaskPrompt({ mode, question, studentAnswer, pageNumber }) {
  if (mode === "explain-simple") {
    return [
      `Explain page ${pageNumber} in plain English.`,
      "Keep it concise.",
      "Include: main idea, key terms, and why this page matters.",
      "End with one short comprehension check question.",
    ].join(" ");
  }

  if (mode === "go-deeper") {
    return [
      `Teach page ${pageNumber} in more depth.`,
      "Highlight assumptions, notation, and any derivation or logical step that is easy to miss.",
      "Call out 1-2 common misunderstandings.",
    ].join(" ");
  }

  if (mode === "quiz") {
    return [
      `Ask exactly one question about page ${pageNumber}.`,
      "Use the page content only.",
      "After the question, add a short 'What a strong answer should include' rubric.",
      "Do not reveal the full answer yet.",
    ].join(" ");
  }

  if (mode === "feedback") {
    return [
      `Evaluate the student's answer to a quiz on page ${pageNumber}.`,
      `Student answer: ${studentAnswer || "(empty)"}`,
      "Give: verdict, what they got right, what they missed, and a corrected ideal answer grounded in the page.",
    ].join(" ");
  }

  return [
    `Answer the user's question about page ${pageNumber}.`,
    `User question: ${question || ""}`,
    "Stay grounded in the supplied page.",
    "If the answer needs outside context, label that clearly.",
  ].join(" ");
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(__dirname, "public", safePath);

  try {
    const file = await readFile(filePath);
    const mimeType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Missing request URL." });
    return;
  }

  if (req.method === "POST" && req.url === "/api/respond") {
    await handleResponseRequest(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(PORT, () => {
  console.log(`ProfessorAI listening on http://localhost:${PORT}`);
});
