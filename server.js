import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const XAI_API_KEY = process.env.XAI_API_KEY;
const API_BASE_URL = process.env.XAI_API_BASE_URL || "https://api.x.ai/v1";
const MODEL = process.env.XAI_MODEL || "grok-4.3";

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

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

function extractCompletionText(payload) {
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const messageContent = payload?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    const parts = messageContent
      .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean);
    if (parts.length) {
      return parts.join("\n").trim();
    }
  }

  return "";
}

async function streamTextFallback(res, text) {
  const tokens = text.match(/\S+\s*/g) || [text];

  for (const token of tokens) {
    writeSse(res, "delta", { delta: token });
    await new Promise((resolve) => setTimeout(resolve, 12));
  }

  writeSse(res, "done", { text });
  res.end();
}

function createSseParser(onEvent) {
  let buffer = "";

  return (chunk, { flush = false } = {}) => {
    buffer += chunk.replaceAll("\r\n", "\n");

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split("\n");
      let eventName = "message";
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length) {
        onEvent(eventName, dataLines.join("\n"));
      }
    }

    if (flush) {
      const remainder = buffer.trim();
      buffer = "";
      if (!remainder) {
        return;
      }

      const lines = remainder.split("\n");
      let eventName = "message";
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length) {
        onEvent(eventName, dataLines.join("\n"));
      }
    }
  };
}

function normalizeLearnerProfile(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().split(/\s+/).filter(Boolean).slice(0, 50).join(" ");
}

function excerptText(value, maxLength = 1800) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
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
    documentType,
    pageText,
    question,
    pdfName,
    learnerProfile,
    previousPageNumber,
    previousPageText,
    previousPageSummary,
    chatHistory,
  } = payload;

  if (!mode || !pageNumber || !pageText) {
    sendJson(res, 400, {
      error: "mode, pageNumber, and pageText are required.",
    });
    return;
  }

  const normalizedLearnerProfile = normalizeLearnerProfile(learnerProfile);
  const sourceKind = documentType === "text" ? "chunk" : "page";
  const previousContext = [
    previousPageSummary ? `Previous ${sourceKind} explanation summary: ${excerptText(previousPageSummary, 700)}` : "",
    previousPageText
      ? `Previous ${sourceKind} ${previousPageNumber || pageNumber - 1} text excerpt: ${excerptText(previousPageText)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    "You are ProfessorAI, a patient but rigorous personal tutor teaching from the learner's uploaded course material. " +
    "Your goal is genuine understanding, not generic summarization. " +
    "Stay grounded in the supplied source text and visible source number. " +
    "Cite the current source when you make a claim from the material, using brief references like (page 3) or (chunk 3). " +
    "Use any supplied learner background to tune pacing, assumptions, examples, vocabulary, and the amount of prerequisite explanation. " +
    "Use previous-source context only to connect the current source to what came immediately before; do not let it override the current source. " +
    "If a user asks for something not supported by the supplied source, say that clearly and mark any extra background as outside the notes. " +
    "Prefer concrete examples, common mistake warnings, and short comprehension checks. " +
    "Keep answers focused, useful, and mathematically or technically precise.";

  const userPrompt = [
    `Course material: ${pdfName || "Untitled course material"}`,
    `Current ${sourceKind}: ${pageNumber} of ${totalPages || "unknown"}`,
    normalizedLearnerProfile ? `Learner background: ${normalizedLearnerProfile}` : "",
    previousContext ? `Context from the immediately previous ${sourceKind}:` : "",
    previousContext,
    `Current ${sourceKind} text:`,
    pageText,
    "",
    "Task:",
    buildTaskPrompt({ mode, question, pageNumber, sourceKind }),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const apiRes = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...(Array.isArray(chatHistory)
            ? chatHistory.map((m) => ({ role: m.role, content: m.text }))
            : []),
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!apiRes.ok) {
      const responseJson = await apiRes.json();
      sendJson(res, apiRes.status, {
        error: responseJson?.error?.message || "xAI request failed.",
      });
      return;
    }

    if (!apiRes.body) {
      sendJson(res, 502, { error: "xAI returned no response body." });
      return;
    }

    const upstreamContentType = apiRes.headers.get("content-type") || "";

    if (upstreamContentType.includes("application/json")) {
      const responseJson = await apiRes.json();
      const text = extractCompletionText(responseJson);
      openSse(res);
      await streamTextFallback(res, text || "No response text returned.");
      return;
    }

    openSse(res);

    const decoder = new TextDecoder();
    let finalText = "";
    const parseSse = createSseParser((eventName, rawData) => {
      if (!rawData) {
        return;
      }

      if (rawData === "[DONE]") {
        writeSse(res, "done", { text: finalText.trim() });
        return;
      }

      let eventData;
      try {
        eventData = JSON.parse(rawData);
      } catch {
        return;
      }

      const eventType = eventData.type || eventName;
      const deltaText = eventData.choices?.[0]?.delta?.content;

      if (
        (eventData.object === "chat.completion.chunk" || eventType === "chat.completion.chunk") &&
        typeof deltaText === "string" &&
        deltaText
      ) {
        finalText += deltaText;
        writeSse(res, "delta", { delta: deltaText });
        return;
      }

      const completedText =
        typeof eventData.choices?.[0]?.message?.content === "string"
          ? eventData.choices[0].message.content
          : "";

      if (completedText) {
        if (completedText && !finalText) {
          finalText = completedText;
          writeSse(res, "delta", { delta: completedText });
        }
        writeSse(res, "done", { text: finalText.trim() });
        return;
      }

      if (eventType === "error" || eventData.error) {
        writeSse(res, "error", {
          error: eventData.error?.message || "xAI streaming request failed.",
        });
      }
    });

    for await (const chunk of apiRes.body) {
      parseSse(decoder.decode(chunk, { stream: true }));
    }

    parseSse(decoder.decode(), { flush: true });
    if (!res.writableEnded) {
      writeSse(res, "done", { text: finalText.trim() });
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown server error.",
      });
      return;
    }

    writeSse(res, "error", {
      error: error instanceof Error ? error.message : "Unknown server error.",
    });
    res.end();
  }
}

function buildTaskPrompt({ mode, question, pageNumber, sourceKind = "page" }) {
  const sourceRef = `${sourceKind} ${pageNumber}`;
  const sourceSupported = `${sourceKind}-supported`;

  if (mode === "explain-simple") {
    return [
      `Explain ${sourceRef} at the right level for the learner's background.`,
      "Use this structure:",
      "1. The main idea in plain language.",
      "2. Key terms or formulas the learner must understand.",
      `3. Why this ${sourceKind} matters in the course.`,
      "4. One tiny example or analogy tailored to the learner.",
      "5. One short comprehension check question.",
      `Keep it concise and cite ${sourceSupported} claims.`,
    ].join(" ");
  }

  if (mode === "concept-map") {
    return [
      `Create a concept map for ${sourceRef}.`,
      "Use headings for: core idea, prerequisites, supporting concepts, connections, and what to watch for.",
      "Show dependencies with arrows using plain text, for example A -> B -> C.",
      `Keep each item short and cite ${sourceSupported} claims.`,
      "End by naming the single concept the learner should master before moving on.",
    ].join(" ");
  }

  if (mode === "worked-example") {
    return [
      `Create a worked example that helps the learner understand ${sourceRef}.`,
      `Base it on the ${sourceKind} content.`,
      "Use this structure: setup, step-by-step solution or reasoning, why each step is valid, and a quick variation for practice.",
      `If the ${sourceKind} does not contain enough detail for a worked example, say what is missing and create a minimal source-grounded example.`,
      `Cite ${sourceSupported} concepts.`,
    ].join(" ");
  }

  if (mode === "misconceptions") {
    return [
      `Identify common confusions a learner may have about ${sourceRef}.`,
      "Use this structure: confusion, why it is tempting, correction, and a quick diagnostic question.",
      `Prioritize misunderstandings suggested by the ${sourceKind} text and the learner profile.`,
      `Cite ${sourceSupported} corrections.`,
    ].join(" ");
  }

  if (mode === "quiz") {
    return [
      `Quiz the learner on ${sourceRef}.`,
      "Create five questions: two recall, two application, and one explanation question.",
      "Do not reveal the answers immediately.",
      "After the questions, add a compact answer key hidden under a clear 'Answer key' heading so the learner can self-check after trying.",
      `Keep questions grounded in the ${sourceKind} and cite the ${sourceKind} in the answer key.`,
    ].join(" ");
  }

  if (mode === "study-plan") {
    return [
      `Tell the learner what to study next after ${sourceRef}.`,
      "Use this structure: what they should understand now, weak spots to review, the next best study action, and one short self-test.",
      `Base the plan on the current ${sourceKind}, previous-${sourceKind} context if supplied, and the learner profile.`,
      `If prerequisite knowledge is implied but not explained in the ${sourceKind}, label it as prerequisite background.`,
      `Keep it practical and cite ${sourceSupported} items.`,
    ].join(" ");
  }

  return [
    `Answer the user's question about ${sourceRef}.`,
    `User question: ${question || ""}`,
    `Stay grounded in the supplied ${sourceKind} and cite ${sourceSupported} claims.`,
    "Answer directly first, then explain the reasoning.",
    "If the learner seems confused, rebuild from the smallest prerequisite concept needed.",
    "If the answer needs outside context, label that clearly.",
    "End with a short check that lets the learner verify they understood.",
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
    res.writeHead(200, { "Content-Type": mimeType, "Cache-Control": "no-store" });
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
