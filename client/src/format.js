export function lessonsOf(course) {
  const lessons = [];
  for (const module of course?.syllabus?.modules || []) {
    for (const lesson of module.lessons || []) {
      lessons.push({ ...lesson, moduleTitle: module.title, moduleSummary: module.summary });
    }
  }
  return lessons;
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(input) {
  const lines = escapeHtml(input).split("\n");
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("### ") || line.startsWith("## ") || line.startsWith("# ")) {
      closeList();
      const level = line.startsWith("### ") ? 3 : line.startsWith("## ") ? 2 : 1;
      const offset = level === 3 ? 4 : level === 2 ? 3 : 2;
      html.push(`<h${level}>${inline(line.slice(offset))}</h${level}>`);
      continue;
    }
    const ordered = line.match(/^\d+\.\s+/);
    const unordered = line.startsWith("- ") || line.startsWith("* ");
    if (unordered || ordered) {
      const next = unordered ? "ul" : "ol";
      if (listType && listType !== next) closeList();
      if (!listType) {
        html.push(`<${next}>`);
        listType = next;
      }
      const content = unordered ? line.slice(2) : line.slice(ordered[0].length);
      html.push(`<li>${inline(content)}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

export function readingTime(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.min(14000, Math.max(4200, (words / 2.5) * 1000));
}
