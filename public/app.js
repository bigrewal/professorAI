import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs";

const state = {
  pdfDoc: null,
  pdfName: "",
  currentPage: 1,
  currentPageText: "",
  previousPageSummary: "",
  latestQuizPrompt: "",
};

const elements = {
  pdfInput: document.querySelector("#pdf-input"),
  pdfName: document.querySelector("#pdf-name"),
  pageIndicator: document.querySelector("#page-indicator"),
  pageStatus: document.querySelector("#page-status"),
  prevPage: document.querySelector("#prev-page"),
  nextPage: document.querySelector("#next-page"),
  canvas: document.querySelector("#pdf-canvas"),
  responseOutput: document.querySelector("#response-output"),
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
  elements.responseOutput.textContent = text;
  elements.responseOutput.classList.toggle("empty", empty);
}

function setControlsEnabled(enabled) {
  for (const button of elements.quickButtons) {
    button.disabled = !enabled;
  }

  elements.questionInput.disabled = !enabled;
  elements.feedbackInput.disabled = !enabled;
  elements.questionButton.disabled = !enabled;
  elements.feedbackButton.disabled = !enabled;
  elements.prevPage.disabled = !enabled || state.currentPage <= 1;
  elements.nextPage.disabled = !enabled || state.currentPage >= (state.pdfDoc?.numPages || 0);
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
  setOutput("Choose Explain Simply, Go Deeper, Quiz Me, or ask your own question.", {
    empty: true,
  });
  setControlsEnabled(true);
}

async function requestLectureAction(mode, extras = {}) {
  if (!state.currentPageText) {
    setOutput("This page does not contain extractable text.", { empty: true });
    return;
  }

  setOutput("Thinking through the current page...");

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
    return;
  }

  const text = payload.text || "No response text returned.";
  setOutput(text);

  if (mode === "quiz") {
    state.latestQuizPrompt = text;
  }

  if (mode === "explain-simple") {
    state.previousPageSummary = text.slice(0, 600);
  }
}

elements.pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setOutput("Loading PDF...", { empty: true });
    await loadPdf(file);
  } catch (error) {
    setOutput(
      error instanceof Error ? `Unable to load this PDF: ${error.message}` : "Unable to load this PDF.",
    );
  }
});

elements.prevPage.addEventListener("click", async () => {
  if (state.currentPage <= 1) {
    return;
  }

  state.currentPage -= 1;
  await renderCurrentPage();
});

elements.nextPage.addEventListener("click", async () => {
  if (!state.pdfDoc || state.currentPage >= state.pdfDoc.numPages) {
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

setControlsEnabled(false);
