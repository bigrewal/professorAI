import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs";

const state = {
  pdfDoc: null,
  pdfName: "",
  currentPage: 1,
  currentPageText: "",
  previousPageSummary: "",
  latestQuizPrompt: "",
  isLoading: false,
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
  responseOutput: document.querySelector("#response-output"),
  responseStatus: document.querySelector("#response-status"),
  copyResponseButton: document.querySelector("#copy-response"),
  quickButtons: Array.from(document.querySelectorAll("[data-mode]")),
  questionForm: document.querySelector("#question-form"),
  questionInput: document.querySelector("#page-question"),
  feedbackForm: document.querySelector("#feedback-form"),
  feedbackInput: document.querySelector("#student-answer"),
  questionButton: document.querySelector("#question-form button"),
  feedbackButton: document.querySelector("#feedback-form button"),
};

const canvasContext = elements.canvas.getContext("2d");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs";

function setOutput(text, { empty = false } = {}) {
  elements.responseOutput.innerHTML = renderMarkdown(text);
  elements.responseOutput.classList.toggle("empty", empty);
}

function setResponseStatus(text, tone = "neutral") {
  elements.responseStatus.textContent = text;
  elements.responseStatus.dataset.tone = tone;
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

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+/);
    const isUnordered = line.startsWith("- ") || line.startsWith("* ");

    if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
      const level = line.startsWith("### ") ? "h3" : line.startsWith("## ") ? "h2" : "h1";
      const offset = level === "h3" ? 4 : level === "h2" ? 3 : 2;
      html.push(`<${level}>${applyInlineMarkdown(line.slice(offset))}</${level}>`);
      continue;
    }

    if (isUnordered || orderedMatch) {
      const nextListType = isUnordered ? "ul" : "ol";
      if (listType && listType !== nextListType) {
        html.push(`</${listType}>`);
        listType = null;
      }
      if (!listType) {
        html.push(`<${nextListType}>`);
        listType = nextListType;
      }
      const content = isUnordered ? line.slice(2) : line.slice(orderedMatch[0].length);
      html.push(`<li>${applyInlineMarkdown(content)}</li>`);
      continue;
    }

    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }

    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  if (listType) {
    html.push(`</${listType}>`);
  }

  return html.join("\n");
}

function setControlsEnabled(enabled) {
  for (const button of elements.quickButtons) {
    button.disabled = !enabled || state.isLoading;
  }

  const interactiveEnabled = enabled && !state.isLoading;
  elements.questionInput.disabled = !interactiveEnabled;
  elements.feedbackInput.disabled = !interactiveEnabled;
  elements.questionButton.disabled = !interactiveEnabled;
  elements.feedbackButton.disabled = !interactiveEnabled;
  elements.prevPage.disabled = !interactiveEnabled || state.currentPage <= 1;
  elements.nextPage.disabled =
    !interactiveEnabled || state.currentPage >= (state.pdfDoc?.numPages || 0);
  elements.copyResponseButton.disabled = elements.responseOutput.classList.contains("empty");
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
  state.previousPageSummary = "";
  state.latestQuizPrompt = "";
  elements.pdfName.textContent = file.name;
  await renderCurrentPage();
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

  const content = await page.getTextContent();
  state.currentPageText = content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  elements.pageIndicator.textContent = `${state.currentPage} / ${state.pdfDoc.numPages}`;
  elements.pageStatus.textContent = `Showing page ${state.currentPage}`;
  updateProgress();
  setOutput("Choose Explain Simply, Go Deeper, Quiz Me, or ask your own question.", {
    empty: true,
  });
  setResponseStatus("Ready", "success");
  setControlsEnabled(true);
}

async function requestLectureAction(mode, extras = {}) {
  if (!state.currentPageText) {
    setOutput("This page does not contain extractable text.", { empty: true });
    setResponseStatus("No extractable text", "warning");
    return;
  }

  state.isLoading = true;
  setControlsEnabled(true);
  setResponseStatus("Thinking", "loading");
  setOutput("Thinking through the current page...");

  try {
    const response = await fetch("/api/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        pageNumber: state.currentPage,
        totalPages: state.pdfDoc?.numPages || null,
        pageText: state.currentPageText,
        pdfName: state.pdfName,
        previousPageSummary: state.previousPageSummary,
        ...extras,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setOutput(payload.error || "Request failed.");
      setResponseStatus("Request failed", "warning");
      return;
    }

    const text = payload.text || "No response text returned.";
    setOutput(text);
    setResponseStatus("Ready", "success");

    if (mode === "quiz") {
      state.latestQuizPrompt = text;
    }

    if (mode === "explain-simple") {
      state.previousPageSummary = text.slice(0, 600);
    }
  } catch (error) {
    setOutput(error instanceof Error ? error.message : "Unknown request error.");
    setResponseStatus("Network error", "warning");
  } finally {
    state.isLoading = false;
    setControlsEnabled(true);
  }
}

elements.copyResponseButton.addEventListener("click", async () => {
  const text = elements.responseOutput.textContent?.trim();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    const original = elements.copyResponseButton.textContent;
    elements.copyResponseButton.textContent = "Copied";
    setTimeout(() => {
      elements.copyResponseButton.textContent = original;
    }, 1200);
  } catch {
    setResponseStatus("Copy unavailable in this browser", "warning");
  }
});

elements.pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setOutput("Loading PDF...", { empty: true });
    setResponseStatus("Loading PDF", "loading");
    await loadPdf(file);
  } catch (error) {
    setOutput(
      error instanceof Error ? `Unable to load this PDF: ${error.message}` : "Unable to load this PDF.",
    );
    setResponseStatus("Unable to load PDF", "warning");
  }
});

elements.prevPage.addEventListener("click", async () => {
  if (state.currentPage <= 1 || state.isLoading) {
    return;
  }

  state.currentPage -= 1;
  await renderCurrentPage();
});

elements.nextPage.addEventListener("click", async () => {
  if (!state.pdfDoc || state.currentPage >= state.pdfDoc.numPages || state.isLoading) {
    return;
  }

  state.currentPage += 1;
  await renderCurrentPage();
});

for (const button of elements.quickButtons) {
  button.addEventListener("click", async () => {
    await requestLectureAction(button.dataset.mode);
  });
}

elements.questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question) {
    setOutput("Enter a question about the current page.");
    return;
  }

  await requestLectureAction("ask", { question });
});

elements.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentAnswer = elements.feedbackInput.value.trim();
  if (!studentAnswer) {
    setOutput("Write an answer before asking for feedback.");
    return;
  }

  await requestLectureAction("feedback", {
    studentAnswer,
    question: state.latestQuizPrompt,
  });
});

window.addEventListener("keydown", async (event) => {
  if (!state.pdfDoc || state.isLoading) {
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    elements.nextPage.click();
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    elements.prevPage.click();
  }
});

setControlsEnabled(false);
setResponseStatus("Upload a PDF to begin", "neutral");
updateProgress();
