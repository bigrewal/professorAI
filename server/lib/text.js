export function nowIso() {
  return new Date().toISOString();
}

export function withoutHeading(value) {
  const lines = String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines[0] || "";
  const headingWords = heading.split(/\s+/).filter(Boolean);
  if (
    lines.length > 1 &&
    heading.length <= 72 &&
    headingWords.length <= 10 &&
    !/[.!?]$/.test(heading)
  ) {
    return lines.slice(1).join("\n");
  }
  return lines.join("\n");
}

export function excerptText(value, maxLength = 1800) {
  const text = withoutHeading(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

export function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function limitWords(value, maxWords) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

export function safeDisplayName(value, fallback = "Untitled") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || fallback;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function clampText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export function extractJson(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("The tutor returned an empty plan.");
  }

  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.unshift(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }

  throw new Error("The tutor returned a plan that could not be read.");
}

export function splitSentences(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [text];
}

export function condenseWords(value, maxWords) {
  const sentences = splitSentences(value);
  let used = 0;
  const kept = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (used && used + words.length > maxWords) break;
    if (!used && words.length > maxWords) {
      return `${words.slice(0, maxWords).join(" ")}…`;
    }
    kept.push(sentence);
    used += words.length;
  }
  return kept.join(" ") || limitWords(value, maxWords);
}

const TITLE_ENDINGS = new Set(["a", "an", "the", "of", "as", "to", "and", "or", "in", "on", "for", "with", "from", "by"]);

export function inferTitle(text, fallback = "Lesson") {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => {
    const words = line.split(/\s+/);
    return line.length >= 3 && line.length <= 72 && words.length <= 10 && !/[.?!]$/.test(line);
  });
  if (heading) return heading.replace(/\s+/g, " ");

  const sentence = (lines[0] || fallback).replace(/[.?!]+$/, "");
  const words = sentence.split(/\s+/).filter(Boolean).slice(0, 7);
  while (words.length > 3 && TITLE_ENDINGS.has(words.at(-1).toLowerCase().replace(/[^a-z]/g, ""))) {
    words.pop();
  }
  const title = words.join(" ") || fallback;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function keywords(value) {
  const stops = new Set(
    "a an the of as to and or in on for with from by is are was were be been being this that those these it its at into over under we you your our they their i me my not do does did can could should would will just than then so if but about what when where how why which who whom whose".split(
      " ",
    ),
  );
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stops.has(word));
}

export function overlapScore(text, terms) {
  const haystack = ` ${String(text || "").toLowerCase()} `;
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(` ${term} `) || haystack.includes(term)) score += 1;
  }
  return score;
}
