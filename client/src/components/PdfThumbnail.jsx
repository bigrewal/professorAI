import { useEffect, useRef, useState } from "react";
import { openPdf } from "../pdf.js";
import { Icon } from "./icons.jsx";

export function PdfThumbnail({ url, name }) {
  const host = useRef(null);
  const canvas = useRef(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "150px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return undefined;
    let stopped = false;
    let render;
    const task = openPdf(url);
    (async () => {
      const document = await task.promise;
      const page = await document.getPage(1);
      if (stopped) return;
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 340 / original.width });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      render = page.render({ canvasContext: element.getContext("2d"), viewport });
      await render.promise;
      if (!stopped) setStatus("ready");
    })().catch(() => { if (!stopped) setStatus("error"); })
      .finally(() => task.destroy().catch(() => {}));
    return () => { stopped = true; render?.cancel(); void task.destroy().catch(() => {}); };
  }, [visible, url]);
  return <div className="pdf-thumbnail" ref={host} data-status={status}>
    <canvas ref={canvas} role="img" aria-label={`PDF thumbnail: ${name}`} style={{ visibility: status === "ready" ? "visible" : "hidden" }} />
    {status !== "ready" ? <span className="thumbnail-placeholder"><Icon name="book" size={32} /><span>{status === "error" ? "Preview unavailable" : "Loading preview…"}</span></span> : null}
    <span className="thumbnail-format">PDF</span>
  </div>;
}
