import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { professorApi } from "../api.js";
import { Icon } from "../components/icons.jsx";
const PdfPage = lazy(() => import("../components/PdfPage.jsx").then((module) => ({ default: module.PdfPage })));
import { RenameCourse } from "../components/RenameCourse.jsx";
import { PageChatReset } from "../components/PageChatReset.jsx";

const pageKey = (page) => `${page.documentId}:${page.number ?? page.page}`;

function mergeRecords(current = [], incoming = []) {
  return [...new Map([...current, ...incoming].map((record) => [pageKey(record), record])).values()];
}

export function Reader({ course, models, initialDocumentId, onCourse, onRefreshList }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [messages, setMessages] = useState(course.chat || []);
  const [loadError, setLoadError] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [liveAnswer, setLiveAnswer] = useState("");
  const [draftExplain, setDraftExplain] = useState("");
  const [explainError, setExplainError] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [manualPage, setManualPage] = useState("");
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);
  const messagesRef = useRef(messages);
  const revisions = useRef(new Map());
  messagesRef.current = messages;
  revisions.current = new Map(pages.map((item) => [pageKey(item), item.chatRevision]));
  const page = pages[index] || null;
  const thread = messages.filter((message) => page && message.documentId === page.documentId && message.page === page.number);
  const explainedCount = pages.filter((item) => item.explained).length;
  const documentPages = pages.filter((item) => item.documentId === page?.documentId);
  const fileUrl = page ? `/api/courses/${course.id}/documents/${page.documentId}/file` : "";

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setLoadError("");
    professorApi.pages(course.id).then((payload) => {
      if (stopped) return;
      const next = payload.pages || [];
      setPages(next);
      const saved = next.findIndex((item) => (!initialDocumentId || item.documentId === initialDocumentId) && item.documentId === course.progress?.page?.documentId && item.number === course.progress?.page?.number);
      const requested = initialDocumentId ? next.findIndex((item) => item.documentId === initialDocumentId) : 0;
      setIndex(saved >= 0 ? saved : Math.max(0, requested));
    }).catch((error) => { if (!stopped) setLoadError(error.message); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
    // Page position is restored only when opening a course or adding a document.
  }, [course.id, course.documents?.length, initialDocumentId]);

  useEffect(() => {
    if (!page) return;
    professorApi.saveProgress(course.id, { paused: true, page: { documentId: page.documentId, number: page.number } })
      .then(({ progress }) => onCourse((current) => current?.id === course.id ? { ...current, progress } : current))
      .catch((error) => setActionError(`Could not save your place: ${error.message}`));
  }, [course.id, page?.documentId, page?.number, onCourse]);

  useEffect(() => {
    setDraftExplain("");
    setExplainError("");
    setExplaining(false);
    if (!page?.canExplain || page.explanation || (!page.autoExplain && manualPage !== pageKey(page))) return undefined;
    const saved = messagesRef.current.some((message) => message.kind === "explain" && message.documentId === page.documentId && message.page === page.number);
    if (saved) return undefined;
    let stopped = false;
    setExplaining(true);
    professorApi.explain(course.id, { documentId: page.documentId, page: page.number, chatRevision: page.chatRevision }, {
      onDelta: (delta) => { if (!stopped) setDraftExplain((current) => current + delta); },
      onDone: (text, data) => {
        if (revisions.current.get(pageKey(page)) !== page.chatRevision) return;
        // Save the tick even if the user turned the page during the explanation.
        const records = (data.explainedPages || [{ documentId: page.documentId, page: page.number, explainedAt: data.explainedAt, chatRevision: page.chatRevision }])
          .filter((record) => revisions.current.get(pageKey(record)) === record.chatRevision);
        const keys = new Set(records.map(pageKey));
        setPages((current) => current.map((item) => ({
          ...item,
          explained: item.explained || keys.has(pageKey(item)),
          ...(pageKey(item) === pageKey(page) ? { explanation: text, explainedAt: data.explainedAt } : {}),
        })));
        const chat = (data.chat || []).filter((message) => revisions.current.get(pageKey(message)) === (message.chatRevision || 0));
        setMessages((current) => [...new Map([...current, ...chat].map((message) => [message.id, message])).values()]);
        onCourse((current) => {
          if (current?.id !== course.id) return current;
          const explainedPages = mergeRecords(current.explainedPages, records);
          const documents = current.documents.map((document) => ({ ...document, taughtPages: explainedPages.filter((record) => record.documentId === document.id).length }));
          return { ...current, explainedPages, documents, taughtPages: documents.reduce((sum, document) => sum + document.taughtPages, 0) };
        });
        if (!stopped) { setDraftExplain(""); setExplaining(false); }
      },
    }).catch((error) => { if (!stopped) { setExplainError(error.message); setExplaining(false); } });
    return () => { stopped = true; };
  }, [course.id, page?.documentId, page?.number, page?.chatRevision, onCourse, retryKey, manualPage]);

  function goToPage(nextIndex) {
    if (!pages[nextIndex] || asking) return;
    setIndex(nextIndex);
    setQuestion("");
    setLiveAnswer("");
    setActionError("");
    setManualPage("");
  }

  async function submitQuestion(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!page?.canExplain || !trimmed || asking) return;
    setAsking(true);
    setActionError("");
    setQuestion("");
    setLiveAnswer("");
    try {
      await professorApi.ask(course.id, { documentId: page.documentId, page: page.number, question: trimmed, chatRevision: page.chatRevision }, {
        onDelta: (delta) => setLiveAnswer((current) => current + delta),
        onDone: (_text, data) => {
          setLiveAnswer("");
          if (data?.chat) {
            const chat = data.chat.filter((message) => revisions.current.get(pageKey(message)) === (message.chatRevision || 0));
            setMessages(chat);
            onCourse((current) => current?.id === course.id ? { ...current, chat } : current);
          }
        },
      });
    } catch (error) { setLiveAnswer(""); setQuestion(trimmed); setActionError(error.message); }
    finally { setAsking(false); }
  }

  async function addMaterial(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("materials", file);
    setWorking(true);
    setActionError("");
    try {
      const payload = await professorApi.addMaterials(course.id, form);
      onCourse((current) => current?.id === course.id ? payload.course : current);
      await onRefreshList();
    } catch (error) { setActionError(error.message); }
    finally { setWorking(false); }
  }

  if (loadError) return <main className="dash"><p className="form-error" role="alert">{loadError}</p><a className="text-btn" href="#/?panel=courses">Back to courses</a></main>;
  if (!page) return <main className="dash"><header className="welcome"><div><h1>{course.title}</h1><p role="status">{loading ? "Opening your materials…" : course.status === "building" ? "Preparing your course…" : "This course has no pages to display yet."}</p></div></header></main>;

  return (
    <main className="reader">
      <section className="page-column">
        <header className="reader-bar">
          <div className="reader-title">
            <a className="text-btn reader-back" href="#/?panel=courses">← Courses</a>
            <h1>{course.title}</h1>
            <p>{page.documentName} · {page.label} of {documentPages.length}</p>
          </div>
          <div className="reader-actions">
            <RenameCourse course={course} onRenamed={(renamed) => {
              onCourse((current) => current?.id === course.id ? { ...current, title: renamed.title } : current);
              onRefreshList().catch(() => {});
            }} />
            <label className="text-btn">{working ? "Adding materials…" : "Add materials"}
              <input disabled={working || asking} className="sr-only" type="file" accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,application/pdf" onChange={addMaterial} />
            </label>
            <button type="button" className="text-btn" disabled={working || asking} onClick={() => {
              if (!window.confirm(`Delete ${course.title}?`)) return;
              setWorking(true);
              professorApi.removeCourse(course.id).then(() => { window.location.hash = "#/?panel=courses"; onRefreshList().catch(() => {}); })
                .catch((error) => { setActionError(error.message); setWorking(false); });
            }}>Delete</button>
          </div>
        </header>
        {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
        <details className="page-map">
          <summary><Icon name="grid" size={16} /><span>Pages</span><span className="page-map-count">{explainedCount} of {pages.length} explained</span></summary>
          <div className="page-map-content">
            {(course.documents || []).map((document) => {
              const items = pages.map((item, pageIndex) => ({ ...item, pageIndex })).filter((item) => item.documentId === document.id);
              if (!items.length) return null;
              return <section key={document.id}>
                <h2>{document.originalName || document.name}</h2>
                <div className="page-grid">{items.map((item) => (
                  <button key={pageKey(item)} type="button" className="page-chip" data-explained={item.explained} aria-current={item.pageIndex === index ? "page" : undefined}
                    aria-label={`${item.label}${item.explained ? ", explained" : ", not explained yet"}`} title={`${item.label} · ${item.explained ? "Explained" : "Not explained yet"}`} disabled={asking} onClick={() => goToPage(item.pageIndex)}>
                    <span>{item.number}</span>{item.explained ? <Icon name="check" size={15} /> : <span className="page-pending" aria-hidden="true" />}
                  </button>
                ))}</div>
              </section>;
            })}
          </div>
        </details>
        <div className="page-status-row"><span>{page.isPdf ? "Original document" : "Course material"}</span><span className="page-explained" data-explained={page.explained} role="status">
          {page.explained ? <><Icon name="check" size={16} />Explained</> : explaining ? "Professor is explaining…" : page.canExplain ? "Not explained yet" : "No readable text on this page"}
        </span></div>
        {page.isPdf ? <Suspense fallback={<div className="loading-state" role="status">Opening the PDF viewer…</div>}><PdfPage url={fileUrl} pageNumber={page.number} documentName={page.documentName} text={page.text} /></Suspense> : <article className="page-sheet">{page.text}</article>}
        <div className="page-turn">
          <button type="button" className="text-btn" disabled={index === 0 || asking} onClick={() => goToPage(index - 1)}>← Previous page</button>
          <span>{index + 1} / {pages.length}</span>
          <button type="button" className="ink-btn" disabled={index >= pages.length - 1 || asking} onClick={() => goToPage(index + 1)}>Next page →</button>
        </div>
      </section>
      <section className="tutor-pane" aria-label="Explanation and questions">
        <header className="tutor-heading"><div className="tutor-heading-row"><h2>Your tutor</h2><PageChatReset courseId={course.id} page={page} disabled={asking || explaining || working} onReset={({ course: nextCourse, page: nextPage }) => {
          revisions.current.set(pageKey(nextPage), nextPage.chatRevision);
          setPages((current) => current.map((item) => pageKey(item) === pageKey(nextPage) ? nextPage : item));
          setMessages(nextCourse.chat || []);
          setQuestion(""); setLiveAnswer(""); setDraftExplain(""); setExplainError(""); setManualPage(""); setActionError("");
          onCourse((current) => current?.id === course.id ? nextCourse : current);
          onRefreshList().catch(() => {});
        }} /></div><p>Explore this page together. Saved explanations count toward your progress.</p><div className="tutor-connection" data-live={Boolean(models?.live)}><span />{models?.live ? `${models.selectedLabel} · selected for new replies` : "Notes only · no LLM connected"}</div></header>
        <div className="tutor-log" aria-busy={explaining || asking}>
          {!page.canExplain ? <p className="study-notice">This page is blank or contains no readable text for the tutor. You can view the PDF and turn to the next page.</p> : null}
          {page.canExplain && !page.explanation && !page.autoExplain && !explaining ? <div className="fresh-page"><span className="tile"><Icon name="book" size={24} /></span><h3>A fresh start for this page</h3><p>Ask a new question, or get a new explanation when you’re ready.</p><button type="button" className="ink-btn" disabled={asking} onClick={() => { setManualPage(pageKey(page)); setRetryKey((key) => key + 1); }}>Explain this page</button></div> : null}
          {explaining && !draftExplain ? <p className="study-notice" role="status">Preparing your explanation…</p> : null}
          {page.explanation && !thread.some((message) => message.kind === "explain") ? <article className="bubble teacher"><span>Professor · saved explanation</span><p>{page.explanation}</p></article> : null}
          {thread.map((message) => <article key={message.id} className={message.role === "student" ? "bubble student" : "bubble teacher"}><span>{message.role === "student" ? "You" : "Professor"}</span><p>{message.text}</p></article>)}
          {draftExplain && !page.explained ? <article className="bubble teacher"><span>Professor</span><p>{draftExplain}</p></article> : null}
          {liveAnswer ? <article className="bubble teacher"><span>Professor</span><p>{liveAnswer}</p></article> : null}
          {explainError ? <div className="error-banner" role="alert"><span>{explainError}</span><button type="button" className="text-btn" onClick={() => { setManualPage(pageKey(page)); setRetryKey((key) => key + 1); }}>Try again</button></div> : null}
        </div>
        <form className="tutor-ask" onSubmit={submitQuestion}>
          <label className="sr-only" htmlFor="page-question">Ask about this page</label>
          <textarea id="page-question" rows={2} maxLength={2000} disabled={asking || !page.canExplain} value={question} placeholder="Ask about this page…" onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" className="ink-btn" disabled={!question.trim() || asking || !page.canExplain}>{asking ? "Answering…" : "Ask"}</button>
        </form>
      </section>
    </main>
  );
}
