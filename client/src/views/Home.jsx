import { Avatar, Icon } from "../components/icons.jsx";
import { RenameCourse } from "../components/RenameCourse.jsx";
import { learnerName } from "../components/UploadDialog.jsx";
import { ProgressView } from "./Progress.jsx";

export function Home({ courses, error, loading, onRetry, query, panel, onOpen, onOpenDocument, onProgress, onUpload, onRenamed }) {
  const name = learnerName() || courses.find((course) => course.learner?.name)?.learner?.name || "";
  const needle = query.trim().toLowerCase();
  const visible = courses.filter((course) => !needle || `${course.title} ${(course.documents || []).map((document) => document.originalName || document.name).join(" ")}`.toLowerCase().includes(needle));
  const total = courses.reduce((sum, course) => sum + (course.totalPages || 0), 0);
  const taught = courses.reduce((sum, course) => sum + (course.taughtPages || 0), 0);
  const resume = courses.find((course) => course.totalPages > 0);
  if (loading) return <main className="dash" aria-busy="true"><div className="loading-state" role="status"><span className="loading-dot" />Opening your study space…</div></main>;
  if (panel === "progress") return <><LoadError error={error} onRetry={onRetry} /><ProgressView courses={courses} query={query} onOpen={onOpen} onOpenDocument={onOpenDocument} onProgress={onProgress} onUpload={onUpload} onRenamed={onRenamed} /></>;

  return <main className="dash">
    <header className="welcome"><Avatar name={name} /><div><h1>{name ? `Welcome back, ${name}` : "Your study space"}</h1><p>A little progress, one page at a time.</p></div><button type="button" className="ink-btn welcome-action" onClick={onUpload}><Icon name="plus" size={16} />New course</button></header>
    <LoadError error={error} onRetry={onRetry} />
    {panel === "dashboard" && !needle ? <>
      <section className="study-hero"><div className="hero-copy"><span className="eyebrow">{resume ? "PICK UP WHERE YOU LEFT OFF" : "MADE FOR YOUR WAY OF LEARNING"}</span><h2>{resume?.title || "Your notes. A clearer way forward."}</h2><p>{resume ? `${resume.taughtPages || 0} of ${resume.totalPages} pages explained. Your tutor is ready for the next idea.` : "Bring your PDFs and read them alongside a tutor, one page at a time."}</p><button type="button" className="ink-btn" onClick={() => resume ? onOpen(resume.id) : onUpload()}>{resume ? "Continue reading" : "Create your first course"}<Icon name="arrow" size={16} /></button></div><div className="hero-art" aria-hidden="true"><Icon name="book" size={62} /><span>ONE PAGE AT A TIME</span></div></section>
      <section className="stats" aria-label="Overview"><Stat label="Your courses" value={courses.length} icon="book" /><Stat label="Pages explained" value={taught} icon="check" /><Stat label="Page progress" value={`${total ? Math.round(taught / total * 100) : 0}%`} icon="clock" /></section>
    </> : null}
    {panel === "dashboard" || panel === "courses" || panel === "certification" ? <section><div className="split-head"><h2 className="section-title">{panel === "certification" ? "All pages explained" : "Your courses"}</h2>{panel === "dashboard" ? <button type="button" className="text-btn" onClick={() => { window.location.hash = "#/?panel=progress"; }}>View all progress →</button> : null}</div>
      <div className="course-pair">{visible.filter((course) => panel !== "certification" || (course.totalPages > 0 && course.taughtPages >= course.totalPages)).map((course) => <CourseCard key={course.id} course={course} onOpen={onOpen} onProgress={onProgress} onRenamed={onRenamed} />)}
        {panel !== "certification" ? <button type="button" className="card course-card empty-card" onClick={onUpload}><span className="tile"><Icon name="plus" /></span><h3>{courses.length ? "Add a course" : "Your first course starts here"}</h3><p>Upload a PDF, notes, or slides.</p></button> : null}
      </div>
      {panel === "certification" && !visible.some((course) => course.totalPages > 0 && course.taughtPages >= course.totalPages) ? <div className="card muted-card">Courses appear here once all their pages have been explained.</div> : null}
      {needle && !visible.length ? <p className="study-notice" role="status">No courses match “{query}”. Try another search.</p> : null}
    </section> : null}
    {panel === "project" || panel === "download" ? <section><h2 className="section-title">{panel === "download" ? "Downloads" : "Your materials"}</h2><div className="stack">
      {visible.flatMap((course) => (course.documents || []).map((document) => <a className="card upcoming" key={document.id} href={`/api/courses/${course.id}/documents/${document.id}/file`}><span className="tile"><Icon name="folder" /></span><span><strong>{document.originalName || document.name}</strong><em>{course.title} · {document.taughtPages || 0} of {document.totalPages} pages explained</em></span></a>))}
      {!visible.some((course) => course.documents?.length) ? <div className="card muted-card">Your uploaded materials will appear here.</div> : null}
    </div></section> : null}
  </main>;
}

function LoadError({ error, onRetry }) {
  return error ? <div className="error-banner" role="alert"><span>{error}</span><button className="text-btn" onClick={onRetry}>Try again</button></div> : null;
}
function Stat({ label, value, icon }) {
  return <article className="card stat"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon name={icon} size={16} /></span></div><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></article>;
}
function CourseCard({ course, onOpen, onProgress, onRenamed }) {
  const percent = course.totalPages ? Math.min(100, Math.round((course.taughtPages || 0) / course.totalPages * 100)) : 0;
  const status = course.status === "building" ? "Preparing" : course.status === "error" ? "Needs attention" : "Ready to read";
  return <article className="card course-card course-card-editable"><button type="button" className="course-open" onClick={() => onOpen(course.id)}><div className="course-card-top"><span className="tile"><Icon name="book" /></span><span className="status-pill" data-status={course.status}>{status}</span></div><h3>{course.title}</h3><p className="course-description">{course.documents?.length || 0} {(course.documents?.length || 0) === 1 ? "document" : "documents"} · {course.totalPages || 0} pages</p><div className="progress-row"><span className="bar" aria-hidden="true"><span style={{width:`${percent}%`}} /></span><span className="progress-label">{course.taughtPages || 0} / {course.totalPages || 0} explained</span></div></button><div className="course-card-footer"><button type="button" className="text-btn" onClick={() => onProgress(course.id)}>View progress →</button><RenameCourse course={course} onRenamed={onRenamed} /></div></article>;
}
