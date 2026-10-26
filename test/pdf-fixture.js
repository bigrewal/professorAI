function pdfEscape(text) {
  return String(text).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrap(text, width = 86) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildSimplePdf(pages) {
  const fontId = 3 + pages.length * 2;
  const objects = new Array(fontId);
  const kids = [];

  pages.forEach((page, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const lines = wrap(page.body);
    let stream = `BT /F1 22 Tf 72 720 Td (${pdfEscape(page.title)}) Tj /F1 12 Tf 0 -48 Td `;
    lines.forEach((line, lineIndex) => {
      stream += lineIndex === 0 ? `(${pdfEscape(line)}) Tj ` : `0 -18 Td (${pdfEscape(line)}) Tj `;
    });
    stream += "ET";
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objects[fontId - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

export const LIMITS_PAGES = [
  {
    title: "Limits",
    body: "The limit of f(x) as x approaches a is the value L that f(x) approaches when x gets arbitrarily close to a, even if f(a) itself is undefined. Limits are how calculus talks about change without jumping straight to a single point.",
  },
  {
    title: "Limit laws",
    body: "When two limits exist, the limit of a sum is the sum of the limits, and the limit of a product is the product of the limits. For a quotient, the limit of the denominator must not be zero. These laws let a complicated expression be broken into pieces we already understand.",
  },
  {
    title: "Continuity",
    body: "A function is continuous at a point a when its limit as x approaches a exists and equals f(a). Graphically, you can draw through that point without lifting the pencil. Polynomials are continuous at every real number, while a rational function is continuous only where its denominator is not zero.",
  },
];
