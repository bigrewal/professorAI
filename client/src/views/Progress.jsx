import { lazy, Suspense } from "react";
import { Icon } from "../components/icons.jsx";
import { RenameCourse } from "../components/RenameCourse.jsx";

const PdfThumbnail = lazy(() => import("../components/PdfThumbnail.jsx").then((module) => ({ default: module.PdfThumbnail })));
const percent = (taught, total) => total ? Math.min(100, Math.round(taught / total * 100)) : 0;

export function ProgressView({ courses, query = "", onOpen, onOpenDocument, onProgress, onUpload, onRenamed, focused = false }) {
  const needle = query.trim().toLowerCase();
  const visible = courses.filter((course) => !needle || `${course.title} ${(course.documents || []).map((document) => document.originalName || document.name).join(" ")}`.toLowerCase().includes(needle));
  const total = visible.reduce((sum, course) => sum + (course.totalPages || 0), 0);
  const taught = visible.reduce((sum, course) => sum + (course.taughtPages || 0), 0);
  const documents = visible.reduce((sum, course) => sum + (course.documents?.length || 0), 0);
  return <main className="dash progress-view">
    <header className="progress-heading">
      <div>{focused ? <a className="text-btn reader-back" href={`#/course/${courses[0].id}`}>← Back to reading</a> : <span className="eyebrow">ONE PAGE AT A TIME</span>}
        <h1>{focused ? courses[0].title : "Your learning progress"}</h1><p>See what you’ve covered and pick up your next page.</p>
      </div>
      {focused ? <RenameCourse course={courses[0]} onRenamed={onRenamed} /> : <button type="button" className="ink-btn" onClick={onUpload}><Icon name="plus" size={16} />New course</button>}
    </header>
    <section className="progress-overview" aria-label="Page progress overview">
      <div className="progress-ring" style={{ "--progress": `${percent(taught, total)}%` }}><strong>{percent(taught, total)}%</strong></div>
      <div className="progress-overview-copy"><span className="eyebrow">PAGES EXPLAINED</span><p><strong>{taught.toLocaleString()}</strong><span> / {total.toLocaleString()} pages</span></p><span>Across {documents} {documents === 1 ? "document" : "documents"}{focused ? " in this course" : ` and ${visible.length} ${visible.length === 1 ? "course" : "courses"}`}.</span></div>
      <div className="progress-legend"><span className="legend-dot" /><span>A page counts after its explanation is saved. This tracks coverage, not understanding.</span></div>
    </section>
    {!visible.length ? <div className="card muted-card">{courses.length ? "No courses match your search." : "Upload your first PDF to start tracking your progress."}</div> : null}
    {visible.map((course) => <section key={course.id} className="progress-course">
      {!focused ? <div className="progress-course-head"><div><h2>{course.title}</h2><p>{course.taughtPages || 0} of {course.totalPages || 0} pages explained</p></div><button type="button" className="text-btn" onClick={() => onProgress(course.id)}>Course progress →</button></div> : <h2 className="section-title">Your course materials</h2>}
      <div className="document-progress-grid">{(course.documents || []).map((document) => {
        const progress = percent(document.taughtPages || 0, document.totalPages);
        return <article className="card document-progress-card" key={document.id}>
          <button type="button" className="document-preview-button" onClick={() => onOpenDocument(course.id, document.id)} aria-label={`Open ${document.originalName || document.name}`}>
            {document.extension === ".pdf" ? <Suspense fallback={<div className="pdf-thumbnail thumbnail-fallback"><Icon name="book" size={32} /></div>}><PdfThumbnail url={`/api/courses/${course.id}/documents/${document.id}/file`} name={document.originalName || document.name} /></Suspense> : <div className="pdf-thumbnail thumbnail-fallback"><Icon name="book" size={40} /><span>{document.extension?.slice(1).toUpperCase() || "FILE"}</span></div>}
          </button>
          <div className="document-progress-copy"><div className="document-progress-top"><span className="document-kind">{document.extension?.slice(1).toUpperCase() || "Document"}</span><span className="document-percent">{progress}% explained</span></div>
            <h3>{document.name || document.originalName}</h3><p className="document-filename">{document.originalName}</p>
            <div className="document-page-count"><Icon name="check" size={17} /><strong>{document.taughtPages || 0}</strong><span>of {document.totalPages} pages explained</span></div>
            <div className="bar" role="progressbar" aria-label={`${document.name}: pages explained`} aria-valuenow={document.taughtPages || 0} aria-valuemin={0} aria-valuemax={document.totalPages || 1}><span style={{width:`${progress}%`}} /></div>
            <button type="button" className="ink-btn document-continue" onClick={() => onOpenDocument(course.id, document.id)}>{document.taughtPages ? "Continue reading" : "Start reading"}<Icon name="arrow" size={16} /></button>
          </div>
        </article>;
      })}</div>
      {!course.documents?.length ? <div className="card muted-card">Materials will appear here once uploaded. <button type="button" className="text-btn" onClick={() => onOpen(course.id)}>Open course</button></div> : null}
    </section>)}
  </main>;
}
