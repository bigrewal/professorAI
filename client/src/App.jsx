import { useCallback, useEffect, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { professorApi } from "./api.js";
import { Shell } from "./components/Shell.jsx";
import { UploadDialog } from "./components/UploadDialog.jsx";
import { CourseView } from "./views/Course.jsx";
import { Home } from "./views/Home.jsx";
import { ProgressView } from "./views/Progress.jsx";

const PANELS = new Set(["dashboard", "courses", "progress", "certification", "project", "download"]);
function decodeSegment(value) { try { return decodeURIComponent(value); } catch { return value; } }
function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  const params = new URLSearchParams(search);
  const course = path.match(/^\/course\/([^/?]+)(\/progress)?/);
  if (course) return { name: course[2] ? "courseProgress" : "course", courseId: decodeSegment(course[1]), documentId: params.get("document") || "", panel: course[2] ? "progress" : "courses" };
  const requested = params.get("panel") || "dashboard";
  return { name: "home", courseId: "", documentId: "", panel: PANELS.has(requested) ? requested : "dashboard" };
}

export function App() {
  const [route, setRoute] = useState(() => parseHash());
  const [models, setModels] = useState(null);
  const [courses, setCourses] = useState([]);
  const [course, setCourse] = useState(null);
  const [homeError, setHomeError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  useEffect(() => {
    const sync = () => setRoute(parseHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const refreshCourses = useCallback(async () => {
    try {
      const payload = await professorApi.courses();
      setCourses(payload.courses || []);
      setHomeError("");
    } catch (error) { setHomeError(error.message); throw error; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { professorApi.models().then(setModels).catch(() => setModels(null)); }, []);
  useEffect(() => { refreshCourses().catch(() => {}); }, [route.name, refreshCourses]);
  useEffect(() => {
    if (!courses.some((item) => item.status === "building")) return undefined;
    const timer = window.setInterval(() => refreshCourses().catch(() => {}), 1100);
    return () => window.clearInterval(timer);
  }, [courses, refreshCourses]);
  useEffect(() => {
    if (!route.courseId) { setCourse(null); return undefined; }
    let stopped = false;
    let timer;
    const load = async () => {
      try {
        const payload = await professorApi.course(route.courseId);
        if (stopped) return;
        setCourse(payload.course);
        if (payload.course.status === "building") timer = window.setTimeout(load, 1100);
      } catch (error) {
        if (!stopped) setCourse({ id: route.courseId, status: "error", error: error.message, documents: [], syllabus: { modules: [] } });
      }
    };
    load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [route.courseId, route.name, course?.status]);

  const openCourse = (id) => { window.location.hash = `#/course/${id}`; };
  const openProgress = (id) => { window.location.hash = `#/course/${id}/progress`; };
  const openDocument = (id, documentId) => { window.location.hash = `#/course/${id}?document=${encodeURIComponent(documentId)}`; };
  const renamed = (next) => {
    setCourses((current) => current.map((item) => item.id === next.id ? { ...item, title: next.title } : item));
    setCourse((current) => current?.id === next.id ? { ...current, title: next.title } : current);
  };
  const visibleCourse = course?.id === route.courseId ? course : null;
  useEffect(() => { document.title = visibleCourse?.title ? `${visibleCourse.title} · Professor` : "Professor"; }, [visibleCourse?.title]);

  return <>
    <Shell panel={route.panel} models={models} onSelectModel={async (modelId) => setModels(await professorApi.saveModel(modelId))}
      query={query} onQuery={setQuery} onUpload={() => setUploadOpen(true)} onNavigate={(panel) => {
        if (panel === "progress" && route.courseId) { openProgress(route.courseId); return; }
        window.location.hash = panel === "dashboard" ? "#/" : `#/?panel=${panel}`;
      }}>
      <div className="sr-only" aria-live="polite">{visibleCourse?.status === "building" ? "Preparing your course." : ""}</div>
      {route.name === "home" ? <Home loading={loading} onRetry={() => { setLoading(true); refreshCourses().catch(() => {}); }} courses={courses} error={homeError} query={query} panel={route.panel} onOpen={openCourse} onProgress={openProgress} onOpenDocument={openDocument} onUpload={() => setUploadOpen(true)} onRenamed={renamed} /> : null}
      {route.name !== "home" && !visibleCourse ? <Flex className="dash" align="center" justify="center" minHeight="40vh"><Text color="gray">Opening the course…</Text></Flex> : null}
      {route.name === "course" && visibleCourse ? <CourseView key={`${visibleCourse.id}:${route.documentId}`} course={visibleCourse} models={models} initialDocumentId={route.documentId} onCourse={setCourse} onRefreshList={refreshCourses} onUpload={() => setUploadOpen(true)} /> : null}
      {route.name === "courseProgress" && visibleCourse ? <ProgressView courses={[visibleCourse]} focused onOpen={openCourse} onOpenDocument={openDocument} onProgress={openProgress} onRenamed={renamed} onUpload={() => setUploadOpen(true)} /> : null}
    </Shell>
    <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={async (created) => { setCourse(created); openCourse(created.id); refreshCourses().catch(() => {}); }} />
  </>;
}
