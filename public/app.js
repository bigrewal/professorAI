import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs";

const state = {
  pdfDoc: null,
  pdfName: "",
  currentPage: 1,
  currentPageText: "",
  pageTextCache: new Map(),
  pageSummaries: new Map(),
  isLoading: false,
  chatHistory: [], // { role: "user"|"assistant", text: string }[]
};

const elements = {
  pdfInput: document.querySelector("#pdf-input"),
  pdfName: document.querySelector("#pdf-name"),
  pageIndicator: document.querySelector("#page-indicator"),
  pageProgressFill: document.querySelector("#page-progress-fill"),
  pageStatus: document.querySelector("#page-status"),
  prevPage: document.querySelector("#prev-page"),
  nextPage: document.querySelector("#next-page"),
  canvas: document.querySelector("#pdf-canvas"),
  chatLog: document.querySelector("#chat-log"),
  responseStatus: document.querySelector("#response-status"),
  learnerProfile: document.querySelector("#learner-profile"),
  learnerProfileCount: document.querySelector("#learner-profile-count"),
  quickButtons: Array.from(document.querySelectorAll("[data-mode]")),
  questionForm: document.querySelector("#question-form"),
  questionInput: document.querySelector("#page-question"),
  questionButton: document.querySelector("#question-form button"),
};

const canvasContext = elements.canvas.getContext("2d");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs";

function clearChat() {
  elements.chatLog.innerHTML = '<p class="chat-empty">Choose an action or ask a question.</p>';
}

function appendUserBubble(text) {
  const empty = elements.chatLog.querySelector(".chat-empty");
  if (empty) empty.remove();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--user";
  bubble.textContent = text;
  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  return bubble;
}

function appendAssistantBubble() {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--assistant";
  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  return bubble;
}

function updateAssistantBubble(bubble, text) {
  bubble.innerHTML = renderMarkdown(text);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function setResponseStatus(text, tone = "neutral") {
  elements.responseStatus.textContent = text;
  elements.responseStatus.dataset.tone = tone;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getLearnerProfile() {
  return elements.learnerProfile.value.trim().replace(/\s+/g, " ");
}

function updateLearnerProfileCount() {
  const wordCount = countWords(elements.learnerProfile.value);
  elements.learnerProfileCount.textContent = `${wordCount}/50 words`;
  elements.learnerProfileCount.dataset.tone = wordCount > 50 ? "warning" : "neutral";
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(input) {
  const lines = escapeHtml(input).split("\n");
  const html = [];
  let listType = null;
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines = [];

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const rawLine of lines) {
    // Fenced code blocks
    if (rawLine.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        closeList();
        inCodeBlock = true;
        codeLang = rawLine.trim().slice(3).trim();
        codeLines = [];
      } else {
        const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        html.push(`<pre><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line)) {
      closeList();
      html.push("<hr>");
      continue;
    }

    // Headings
    if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ")) {
      closeList();
      const level = line.startsWith("### ") ? "h3" : line.startsWith("## ") ? "h2" : "h1";
      const offset = level === "h3" ? 4 : level === "h2" ? 3 : 2;
      html.push(`<${level}>${applyInlineMarkdown(line.slice(offset))}</${level}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      closeList();
      html.push(`<blockquote><p>${applyInlineMarkdown(line.slice(2))}</p></blockquote>`);
      continue;
    }

    // Lists
    const orderedMatch = line.match(/^\d+\.\s+/);
    const isUnordered = line.startsWith("- ") || line.startsWith("* ");

    if (isUnordered || orderedMatch) {
      const nextListType = isUnordered ? "ul" : "ol";
      if (listType && listType !== nextListType) {
        closeList();
      }
      if (!listType) {
        html.push(`<${nextListType}>`);
        listType = nextListType;
      }
      const content = isUnordered ? line.slice(2) : line.slice(orderedMatch[0].length);
      html.push(`<li>${applyInlineMarkdown(content)}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  // Close anything left open
  if (inCodeBlock) {
    html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }
  closeList();

  return html.join("\n");
}

function setControlsEnabled(enabled) {
  for (const button of elements.quickButtons) {
    button.disabled = !enabled || state.isLoading;
  }

  const interactiveEnabled = enabled && !state.isLoading;
  elements.questionInput.disabled = !interactiveEnabled;
  elements.questionButton.disabled = !interactiveEnabled;
  elements.prevPage.disabled = !interactiveEnabled || state.currentPage <= 1;
  elements.nextPage.disabled =
    !interactiveEnabled || state.currentPage >= (state.pdfDoc?.numPages || 0);
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

      if (!dataLines.length) {
        continue;
      }

      try {
        onEvent(eventName, JSON.parse(dataLines.join("\n")));
      } catch {
        continue;
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

      if (!dataLines.length) {
        return;
      }

      try {
        onEvent(eventName, JSON.parse(dataLines.join("\n")));
      } catch {
        return;
      }
    }
  };
}

function updateProgress() {
  if (!state.pdfDoc) {
    elements.pageProgressFill.style.width = "0%";
    return;
  }
  const progress = (state.currentPage / state.pdfDoc.numPages) * 100;
  elements.pageProgressFill.style.width = `${progress}%`;
}

async function loadPdf(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  state.pdfDoc = await loadingTask.promise;
  state.pdfName = file.name;
  state.currentPage = 1;
  state.pageTextCache = new Map();
  state.pageSummaries = new Map();
  state.chatHistory = [];
  elements.pdfName.textContent = file.name;
  await renderCurrentPage();
}

async function getPageText(pageNumber) {
  if (!state.pdfDoc || pageNumber < 1 || pageNumber > state.pdfDoc.numPages) {
    return "";
  }

  if (state.pageTextCache.has(pageNumber)) {
    return state.pageTextCache.get(pageNumber);
  }

  const page = await state.pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  const pageText = content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  state.pageTextCache.set(pageNumber, pageText);
  return pageText;
}

async function renderCurrentPage() {
  if (!state.pdfDoc) {
    return;
  }

  const page = await state.pdfDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1.25 });
  const outputScale = window.devicePixelRatio || 1;

  elements.canvas.width = Math.floor(viewport.width * outputScale);
  elements.canvas.height = Math.floor(viewport.height * outputScale);
  elements.canvas.style.width = `${viewport.width}px`;
  elements.canvas.style.height = `${viewport.height}px`;

  canvasContext.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  await page.render({ canvasContext, viewport }).promise;

  state.currentPageText = await getPageText(state.currentPage);

  elements.pageIndicator.textContent = `${state.currentPage} / ${state.pdfDoc.numPages}`;
  elements.pageStatus.textContent = `Showing page ${state.currentPage}`;
  updateProgress();
  state.chatHistory = [];
  clearChat();
  setResponseStatus("Ready", "success");
  setControlsEnabled(true);
}

async function requestLectureAction(mode, extras = {}) {
  if (!state.currentPageText) {
    setResponseStatus("No extractable text on this page", "warning");
    return;
  }

  const learnerProfile = getLearnerProfile();
  if (countWords(learnerProfile) > 50) {
    setResponseStatus("Keep your background to 50 words or less", "warning");
    elements.learnerProfile.focus();
    return;
  }

  const userLabel = mode === "explain-simple" ? "Explain this page simply." : extras.question || "";
  if (userLabel) appendUserBubble(userLabel);
  const assistantBubble = appendAssistantBubble();

  state.isLoading = true;
  setControlsEnabled(true);
  setResponseStatus("Streaming response…", "loading");

  try {
    const previousPageNumber = state.currentPage - 1;
    const previousPageText =
      previousPageNumber >= 1 && mode === "explain-simple"
        ? await getPageText(previousPageNumber)
        : "";

    const response = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        pageNumber: state.currentPage,
        totalPages: state.pdfDoc?.numPages || null,
        pageText: state.currentPageText,
        pdfName: state.pdfName,
        learnerProfile,
        previousPageNumber: previousPageText ? previousPageNumber : null,
        previousPageText,
        previousPageSummary: state.pageSummaries.get(previousPageNumber) || "",
        chatHistory: state.chatHistory,
        ...extras,
      }),
    });

    if (!response.ok) {
      const payload = await response.json();
      updateAssistantBubble(assistantBubble, payload.error || "Request failed.");
      setResponseStatus("Request failed", "warning");
      return;
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const text = payload.text || "No response text returned.";
      updateAssistantBubble(assistantBubble, text);
      setResponseStatus("Ready", "success");
      if (userLabel) state.chatHistory.push({ role: "user", text: userLabel });
      state.chatHistory.push({ role: "assistant", text });
      if (mode === "explain-simple") state.pageSummaries.set(state.currentPage, text.slice(0, 600));
      return;
    }

    if (!response.body) {
      updateAssistantBubble(assistantBubble, "The server did not return a readable response body.");
      setResponseStatus("No response body", "warning");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let completed = false;
    let rafPending = false;

    function flushToDOM() {
      rafPending = false;
      updateAssistantBubble(assistantBubble, text);
    }

    const parseSse = createSseParser((eventName, data) => {
      if (eventName === "delta" && typeof data.delta === "string") {
        text += data.delta;
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(flushToDOM);
        }
        return;
      }

      if (eventName === "done") {
        if (typeof data.text === "string" && !text) text = data.text;
        updateAssistantBubble(assistantBubble, text);
        completed = true;
        setResponseStatus("Ready", "success");
        if (userLabel) state.chatHistory.push({ role: "user", text: userLabel });
        state.chatHistory.push({ role: "assistant", text });
        if (mode === "explain-simple") state.pageSummaries.set(state.currentPage, text.slice(0, 600));
        return;
      }

      if (eventName === "error") {
        const errorText = typeof data.error === "string" ? data.error : "Streaming failed.";
        updateAssistantBubble(assistantBubble, errorText);
        setResponseStatus("Streaming failed", "warning");
      }
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parseSse(decoder.decode(value, { stream: true }));
    }

    parseSse(decoder.decode(), { flush: true });

    if (!completed) {
      if (userLabel) state.chatHistory.push({ role: "user", text: userLabel });
      if (text) state.chatHistory.push({ role: "assistant", text });
      if (mode === "explain-simple" && text) state.pageSummaries.set(state.currentPage, text.slice(0, 600));
      setResponseStatus(text ? "Ready" : "No response text returned", text ? "success" : "warning");
    }
  } catch (error) {
    updateAssistantBubble(assistantBubble, error instanceof Error ? error.message : "Unknown request error.");
    setResponseStatus("Network error", "warning");
  } finally {
    state.isLoading = false;
    setControlsEnabled(true);
  }
}

elements.learnerProfile.addEventListener("input", updateLearnerProfileCount);

async function goToPage(pageNumber, { explain = false } = {}) {
  if (!state.pdfDoc || state.isLoading) {
    return;
  }

  const nextPageNumber = Math.min(Math.max(pageNumber, 1), state.pdfDoc.numPages);
  if (nextPageNumber === state.currentPage) {
    return;
  }

  state.currentPage = nextPageNumber;
  await renderCurrentPage();

  if (explain) {
    await requestLectureAction("explain-simple");
  }
}

elements.pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setResponseStatus("Loading PDF…", "loading");
    await loadPdf(file);
  } catch (error) {
    setResponseStatus(
      error instanceof Error ? `Unable to load this PDF: ${error.message}` : "Unable to load this PDF.",
      "warning",
    );
  }
});

elements.prevPage.addEventListener("click", async () => {
  await goToPage(state.currentPage - 1);
});

elements.nextPage.addEventListener("click", async () => {
  await goToPage(state.currentPage + 1, { explain: true });
});

for (const button of elements.quickButtons) {
  button.addEventListener("click", async () => {
    await requestLectureAction(button.dataset.mode);
  });
}

elements.questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question) return;
  elements.questionInput.value = "";
  await requestLectureAction("ask", { question });
});

elements.questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.questionForm.requestSubmit();
  }
});


window.addEventListener("keydown", async (event) => {
  if (!state.pdfDoc || state.isLoading || isTypingTarget(event.target)) {
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    await goToPage(state.currentPage + 1);
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    await goToPage(state.currentPage - 1);
  }
});

setControlsEnabled(false);
setResponseStatus("Upload a PDF to begin", "neutral");
updateLearnerProfileCount();
updateProgress();
