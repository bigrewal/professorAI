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
  const previousContext = [
    previousPageSummary ? `Previous page explanation summary: ${excerptText(previousPageSummary, 700)}` : "",
    previousPageText
      ? `Previous page ${previousPageNumber || pageNumber - 1} text excerpt: ${excerptText(previousPageText)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    "You are an expert course instructor teaching from lecture notes. " +
    "Stay grounded in the supplied page text and the visible page number. " +
    "Use any supplied learner background to tune pacing, assumptions, examples, and vocabulary. " +
    "Use previous-page context only to connect the current page to what came immediately before; do not let it override the current page. " +
    "If a user asks for something not supported by the page, say that clearly and mark any extra background as outside the notes. " +
    "Keep explanations crisp, use bullets when helpful, and preserve mathematical precision.";

  const userPrompt = [
    `PDF: ${pdfName || "Untitled lecture notes"}`,
    `Current page: ${pageNumber} of ${totalPages || "unknown"}`,
    normalizedLearnerProfile ? `Learner background: ${normalizedLearnerProfile}` : "",
    previousContext ? "Context from the immediately previous page:" : "",
    previousContext,
    "Current page text:",
    pageText,
    "",
    "Task:",
    buildTaskPrompt({ mode, question, pageNumber }),
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

function buildTaskPrompt({ mode, question, pageNumber }) {
  if (mode === "explain-simple") {
    return [
      `Explain page ${pageNumber} at the right level for the learner's background.`,
      "Keep it concise.",
      "Adapt assumptions, examples, and terminology to the learner profile if one is supplied.",
      "Include: main idea, key terms, and why this page matters.",
      "End with one short comprehension check question.",
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
