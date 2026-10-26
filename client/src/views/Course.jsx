import { useState } from "react";
import { Reader } from "./Reader.jsx";
import { professorApi } from "../api.js";

export function CourseView({ course, models, initialDocumentId, onCourse, onRefreshList, onUpload }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setRetrying(true);
    setError("");
    try {
      const payload = await professorApi.rebuild(course.id);
      onCourse(payload.course);
      await onRefreshList();
    } catch (caught) { setError(caught.message); }
    finally { setRetrying(false); }
  }

  if (course.status === "error" && !course.documents?.some((document) => document.extension === ".pdf" && document.totalPages > 0)) {
    return (
      <main className="dash">
        <header className="welcome"><div><h1>{course.title || "Course unavailable"}</h1><p>Let’s get you back to learning.</p></div></header>
        <div className="error-banner" role="alert">{error || course.error || "Try a text-based PDF, notes, or slides."}</div>
        <div className="action-row">
          <button type="button" className="ink-btn" disabled={retrying} onClick={retry}>{retrying ? "Trying again…" : "Try again"}</button>
          <button type="button" className="text-btn" onClick={onUpload}>Upload another course</button>
          <a className="text-btn" href="#/">Back to dashboard</a>
        </div>
      </main>
    );
  }

  return <Reader course={course} models={models} initialDocumentId={initialDocumentId} onCourse={onCourse} onRefreshList={onRefreshList} />;
}
