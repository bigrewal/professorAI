async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  return parseResponse(response);
}

function handleSseBlock(raw, handlers) {
  const lines = raw.split("\n");
  let eventName = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  let data = {};
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  if (eventName === "delta" && typeof data.delta === "string") handlers.onDelta?.(data.delta);
  if (eventName === "done") handlers.onDone?.(data.text || "", data);
  if (eventName === "error") handlers.onError?.(data.error || "The tutor could not answer.");
}

export async function readSse(response, handlers = {}) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Request failed.");
  }
  if (!response.body) throw new Error("The tutor returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawError = "";

  let sawDone = false;
  const callbacks = {
    ...handlers,
    onDone: (...args) => {
      sawDone = true;
      handlers.onDone?.(...args);
    },
    onError: (message) => { sawError = message; },
  };
  const consume = (chunk, flush = false) => {
    buffer += chunk;
    // Normalize after buffering: a CRLF pair can span network chunks.
    buffer = buffer.replaceAll("\r\n", "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      handleSseBlock(buffer.slice(0, boundary), callbacks);
      buffer = buffer.slice(boundary + 2);
    }
    if (flush && buffer.trim()) {
      handleSseBlock(buffer.trim(), callbacks);
      buffer = "";
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
      if (sawError) break;
    }
    consume(decoder.decode(), true);
    if (sawError) throw new Error(sawError);
    if (!sawDone) throw new Error("The connection ended before the tutor finished. Please try again.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const professorApi = {
  health: () => api("/api/health"),
  models: () => api("/api/models"),
  saveModel: (modelId) => api("/api/settings", { method: "PUT", body: JSON.stringify({ modelId }) }),
  courses: () => api("/api/courses"),
  course: (id) => api(`/api/courses/${id}`),
  renameCourse: (id, title) => api(`/api/courses/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  createCourse: (formData) => api("/api/courses", { method: "POST", body: formData }),
  resetPageChat: (id, documentId, page) => api(`/api/courses/${id}/documents/${documentId}/pages/${page}/chat`, { method: "DELETE" }),
  pages: (id) => api(`/api/courses/${id}/pages`),
  addMaterials: (id, formData) => api(`/api/courses/${id}/materials`, { method: "POST", body: formData }),
  rebuild: (id) => api(`/api/courses/${id}/rebuild`, { method: "POST", body: "{}" }),
  removeCourse: (id) => api(`/api/courses/${id}`, { method: "DELETE" }),
  saveLearner: (id, learner) => api(`/api/courses/${id}/learner`, { method: "PATCH", body: JSON.stringify(learner) }),
  saveProgress: (id, progress) => api(`/api/courses/${id}/progress`, { method: "PUT", body: JSON.stringify(progress) }),
  script: (id, lessonId, { refresh = false } = {}) =>
    api(`/api/courses/${id}/lessons/${lessonId}/script${refresh ? "?refresh=1" : ""}`, {
      method: "POST",
      body: "{}",
    }),
  ask: (id, body, onDelta) =>
    fetch(`/api/courses/${id}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => readSse(response, typeof onDelta === "function" ? { onDelta } : onDelta)),
  explain: (id, body, handlers) =>
    fetch(`/api/courses/${id}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => readSse(response, handlers)),
};
