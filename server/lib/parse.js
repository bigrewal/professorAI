import mammoth from "mammoth";
import { OfficeConverter } from "officeparser";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { excerptText } from "./text.js";

export const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".doc", ".docx", ".ppt", ".pptx"]);
const TEXT_EXTENSIONS = new Set([".txt"]);
const LEGACY_OFFICE_EXTENSIONS = new Set([".doc", ".ppt"]);

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
};

export function normalizeExtension(fileName) {
  return extname(fileName || "").toLowerCase();
}

export function getPageUnit(extension) {
  if (extension === ".pdf") return "page";
  if (extension === ".pptx" || extension === ".ppt") return "slide";
  return "chunk";
}

function paginateText(text, maxChars = 3200) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!normalized) return [];

  const pages = [];
  let current = "";

  for (const paragraph of normalized.split(/\n\s*\n/)) {
    const block = paragraph.trim();
    if (!block) continue;

    if (current && `${current}\n\n${block}`.length > maxChars) {
      pages.push(current);
      current = "";
    }

    if (block.length > maxChars) {
      const sentences = block.match(/[^.!?]+[.!?]+|\S.+$/g) || [block];
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        const next = current ? `${current} ${trimmed}` : trimmed;
        if (current && next.length > maxChars) {
          pages.push(current);
          current = trimmed;
        } else {
          current = next;
        }
      }
      continue;
    }

    current = current ? `${current}\n\n${block}` : block;
  }

  if (current) pages.push(current);
  return pages;
}

function createPages(textBlocks, unit) {
  return textBlocks.map((text, index) => {
    const normalized = String(text || "").trim();
    return {
      number: index + 1,
      label: `${unit} ${index + 1}`,
      text: normalized,
      excerpt: excerptText(normalized, 240),
      charCount: normalized.length,
    };
  });
}

function extractPdfPageText(content) {
  const items = content.items
    .filter((item) => item && typeof item.str === "string" && item.str.trim())
    .map((item) => ({
      str: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      width: item.width || 0,
      hasEOL: item.hasEOL,
    }))
    .sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));

  let text = "";
  let lastY = null;
  let lastX = null;
  let lastWidth = 0;

  for (const item of items) {
    if (lastY !== null) {
      const dy = Math.abs(item.y - lastY);
      if (dy > 26) {
        text += "\n\n";
      } else if (!text.endsWith(" ") && !text.endsWith("\n") && !item.str.startsWith(" ")) {
        const gap = dy > 6 ? 2 : item.x - (lastX + lastWidth);
        if (gap > 1.2) text += " ";
      }
    }
    text += item.str;
    if (item.hasEOL) text += "\n";
    lastY = item.y;
    lastX = item.x;
    lastWidth = item.width;
  }

  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function parsePdfPages(filePath) {
  const fileBuffer = await readFile(filePath);
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(fileBuffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = extractPdfPageText(content);
      pages.push(text || "[No extractable text on this PDF page.]");
      page.cleanup();
    }
  } finally {
    if (typeof pdf.destroy === "function") {
      await pdf.destroy();
    } else if (typeof task.destroy === "function") {
      await task.destroy();
    }
  }

  return createPages(pages, "page");
}

export function readablePageCount(pages) {
  return (pages || []).filter((page) => page.text && !page.text.startsWith("[No extractable text")).length;
}

export async function parseDocument(filePath, extension) {
  if (extension === ".pdf") {
    return {
      status: "ready",
      pageUnit: "page",
      pages: await parsePdfPages(filePath),
      parser: "pdfjs-dist",
      warnings: [],
    };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    const text = await readFile(filePath, "utf8");
    return {
      status: "ready",
      pageUnit: "chunk",
      pages: createPages(paginateText(text), "chunk"),
      parser: "text",
      warnings: [],
    };
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      status: "ready",
      pageUnit: "chunk",
      pages: createPages(paginateText(result.value), "chunk"),
      parser: "mammoth",
      warnings: (result.messages || []).map((message) => message.message).filter(Boolean),
    };
  }

  if (extension === ".pptx") {
    const { value, messages } = await OfficeConverter.convert(filePath, "text", {
      parseConfig: {
        ignoreSlideMasters: true,
        ignoreComments: true,
        newlineDelimiter: "\n\n",
      },
      generatorConfig: {
        newlineDelimiter: "\n\n",
      },
    });

    const slides = String(value || "")
      .split(/\n\s*\n/)
      .map((slide) => slide.trim())
      .filter(Boolean);

    return {
      status: "ready",
      pageUnit: "slide",
      pages: createPages(slides.length ? slides : paginateText(value), "slide"),
      parser: "officeparser",
      warnings: (messages || []).map((message) => message.message || message.code).filter(Boolean),
    };
  }

  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    return {
      status: "needs_conversion",
      pageUnit: getPageUnit(extension),
      pages: [],
      parser: "not-available",
      warnings: [
        "This file is stored, but legacy Word and PowerPoint files need a text-based PDF, DOCX, PPTX, or TXT before they can be taught.",
      ],
    };
  }

  throw new Error("Unsupported file type.");
}
