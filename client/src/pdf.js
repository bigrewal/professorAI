import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

export function openPdf(url) {
  return getDocument({
    url, isEvalSupported: false, disableAutoFetch: true, disableStream: true,
    cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/", iccUrl: "/pdf-assets/iccs/",
  });
}
