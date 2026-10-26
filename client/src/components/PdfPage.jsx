import { useEffect, useRef, useState } from "react";
import { openPdf } from "../pdf.js";

export function PdfPage({ url, pageNumber, documentName, text }) {
  const stage = useRef(null);
  const paper = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stopped = false;
    setPdf(null);
    setLoading(true);
    setError("");
    const task = openPdf(url);
    task.promise.then((document) => { if (!stopped) setPdf(document); }).catch((caught) => {
      if (!stopped) { setError(caught.message || "The PDF could not be opened."); setLoading(false); }
    });
    return () => { stopped = true; void task.destroy().catch(() => {}); };
  }, [url, retry]);

  useEffect(() => {
    if (!pdf || !width) return undefined;
    let stopped = false;
    let renderTask;
    const container = paper.current;
    // Each render owns its canvas; cancelled renders cannot draw over a new page.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${documentName}, page ${pageNumber}`);
    container.replaceChildren(canvas);
    setLoading(true);
    setError("");
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (stopped) return;
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / original.width) * zoom });
      const pixelScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
      canvas.width = Math.floor(viewport.width * pixelScale);
      canvas.height = Math.floor(viewport.height * pixelScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: [pixelScale, 0, 0, pixelScale, 0, 0] });
      await renderTask.promise;
      if (!stopped) setLoading(false);
    })().catch((caught) => {
      if (!stopped && caught.name !== "RenderingCancelledException") {
        setError(caught.message || "This PDF page could not be displayed.");
        setLoading(false);
      }
    });
    return () => { stopped = true; renderTask?.cancel(); canvas.remove(); };
  }, [pdf, width, zoom, pageNumber, documentName]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span>Original PDF · page {pageNumber}</span>
        <label>Zoom <select aria-label="PDF zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
          <option value={1}>Fit width</option><option value={1.25}>125%</option><option value={1.5}>150%</option><option value={2}>200%</option>
        </select></label>
        <a href={`${url}#page=${pageNumber}`} target="_blank" rel="noreferrer" className="text-btn">Open original ↗</a>
      </div>
      <div className="pdf-stage" ref={stage} aria-busy={loading}>
        {loading ? <p role="status" className="pdf-loading">Loading PDF page…</p> : null}
        {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-btn" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : null}
        <div className="pdf-paper" ref={paper} style={{ visibility: loading || error ? "hidden" : "visible" }} />
      </div>
      {text ? <div className="sr-only">{text}</div> : null}
    </div>
  );
}
