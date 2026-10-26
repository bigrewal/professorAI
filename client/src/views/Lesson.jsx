import { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Callout, Flex, Heading, Text, TextArea } from "@radix-ui/themes";
import { professorApi } from "../api.js";
import { lessonsOf, readingTime, renderMarkdown } from "../format.js";
import { consumeAutoplay, requestAutoplay } from "../session.js";
import { canListen, canSpeak, listenOnce, speakText, stopSpeaking } from "../voice.js";

export function Lesson({ course, lessonId, models, onCourse, onExit }) {
  const [script, setScript] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [beatIndex, setBeatIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [paused, setPaused] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [checkAnswer, setCheckAnswer] = useState("");
  const [listening, setListening] = useState("");
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem("professor.voice") !== "off");
  const [autopilot, setAutopilot] = useState(() => localStorage.getItem("professor.autopilot") !== "off");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [bridgeTo, setBridgeTo] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const scriptRef = useRef(null);
  const beatRef = useRef(0);
  const pausedRef = useRef(true);
  const askingRef = useRef(false);
  const voiceRef = useRef(voiceOn);
  const autopilotRef = useRef(autopilot);
  const progressRef = useRef(course.progress);
  const timer = useRef(0);
  const stopListen = useRef(() => {});
  const refreshRef = useRef(false);
  const lessons = lessonsOf(course);
  const lessonMeta = lessons.find((lesson) => lesson.id === lessonId);
  const position = lessons.findIndex((lesson) => lesson.id === lessonId);

  voiceRef.current = voiceOn;
  autopilotRef.current = autopilot;
  progressRef.current = course.progress;
  scriptRef.current = script;

  function persist(progress) {
    progressRef.current = progress;
    onCourse((current) => (current ? { ...current, progress } : current));
    professorApi.saveProgress(course.id, progress).catch(() => {});
  }

  function clearAdvance() {
    window.clearTimeout(timer.current);
  }

  function play(index, payload = scriptRef.current) {
    const beat = payload?.beats?.[index];
    if (!beat) return;
    clearAdvance();
    stopSpeaking();
    beatRef.current = index;
    setBeatIndex(index);
    setFurthest((current) => Math.max(current, index));
    setPhase("beat");
    setPaused(false);
    pausedRef.current = false;
    setFeedback(null);
    setCheckAnswer("");
    persist({
      lessonId,
      beatIndex: index,
      completedLessonIds: progressRef.current?.completedLessonIds || [],
      paused: false,
    });

    const advance = (delay) => {
      clearAdvance();
      timer.current = window.setTimeout(() => {
        if (pausedRef.current || askingRef.current || !autopilotRef.current) return;
        const beats = payload.beats || [];
        if (index + 1 >= beats.length) finishLesson();
        else play(index + 1, payload);
      }, delay);
    };

    if (!voiceRef.current || !canSpeak()) {
      setSpeaking(false);
      if (autopilotRef.current && beat.kind !== "check") advance(readingTime(beat.narration));
      return;
    }

    setSpeaking(true);
    speakText(beat.narration, {
      rate: course.learner?.pace === "brisk" ? 1.04 : 0.95,
      onend: () => {
        setSpeaking(false);
        if (!pausedRef.current && !askingRef.current && autopilotRef.current && beat.kind !== "check") advance(800);
      },
    });
  }

  function finishLesson() {
    stopSpeaking();
    clearAdvance();
    pausedRef.current = true;
    setPaused(true);
    setSpeaking(false);
    const next = lessons[position + 1] || null;
    const completed = new Set(progressRef.current?.completedLessonIds || []);
    completed.add(lessonId);
    persist({
      lessonId: next?.id || lessonId,
      beatIndex: 0,
      completedLessonIds: [...completed],
      paused: true,
    });
    setBridgeTo(next);
    setPhase(next ? "bridge" : "done");
  }

  function pause() {
    pausedRef.current = true;
    setPaused(true);
    setSpeaking(false);
    stopSpeaking();
    clearAdvance();
    persist({
      lessonId,
      beatIndex: beatRef.current,
      completedLessonIds: progressRef.current?.completedLessonIds || [],
      paused: true,
    });
  }

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError("");
    setScript(null);
    setFeedback(null);
    const shouldPlay = consumeAutoplay();
    const refresh = refreshRef.current;
    refreshRef.current = false;
    professorApi
      .script(course.id, lessonId, { refresh })
      .then((payload) => {
        if (cancelled) return;
        setScript(payload);
        scriptRef.current = payload;
        const resumeAt = course.progress?.lessonId === lessonId ? course.progress.beatIndex || 0 : 0;
        const index = Math.min(Math.max(resumeAt, 0), Math.max(payload.beats.length - 1, 0));
        beatRef.current = index;
        setBeatIndex(index);
        setFurthest(index);
        setPhase("beat");
        if (shouldPlay) play(index, payload);
        else {
          pausedRef.current = true;
          setPaused(true);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "This lesson could not be prepared.");
          setPhase("error");
        }
      });

    return () => {
      cancelled = true;
      stopSpeaking();
      clearAdvance();
      stopListen.current();
    };
    // The lesson identity and an explicit retell are the only reasons to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, lessonId, refreshKey]);

  useEffect(() => {
    const onKey = (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.code === "Space" && !typing && phase === "beat") {
        event.preventDefault();
        if (pausedRef.current) play(beatRef.current);
        else pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function submitQuestion(text, mode) {
    const trimmed = text.trim();
    if (!trimmed || askingRef.current) return;
    pause();
    askingRef.current = true;
    setAsking(true);
    setFeedback({ mode, text: "" });
    if (mode === "interrupt") setQuestion("");
    try {
      await professorApi.ask(
        course.id,
        { lessonId, beatIndex: beatRef.current, question: trimmed, mode },
        (delta) => setFeedback((current) => ({ mode, text: `${current?.text || ""}${delta}` })),
      );
    } catch (caught) {
      setFeedback({ mode, text: caught instanceof Error ? caught.message : "The tutor could not answer." });
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }

  function startListening(target) {
    if (listening) {
      stopListen.current();
      setListening("");
      return;
    }
    pause();
    setListening(target);
    stopListen.current = listenOnce({
      onpartial: (text) => {
        if (target === "check") setCheckAnswer(text);
        else setQuestion(text);
      },
      onresult: (text) => {
        setListening("");
        if (text && target === "ask") submitQuestion(text, "interrupt");
        if (text && target === "check") setCheckAnswer(text);
      },
      onerror: (caught) => {
        setListening("");
        setFeedback({ mode: "interrupt", text: caught.message });
      },
    });
  }

  const beat = script?.beats?.[beatIndex];
  const differentModel = Boolean(script?.modelId && models?.selected && script.modelId !== models.selected);

  return (
    <main className="player">
      <div className="player-top">
        <Button variant="ghost" color="gray" onClick={onExit}>Back to the path</Button>
        <Box style={{ textAlign: "center" }}>
          <Text as="div" size="1" color="gray">{lessonMeta?.moduleTitle || "Lesson"}</Text>
          <Heading size="4">{lessonMeta?.title || script?.lesson?.title || "Lesson"}</Heading>
        </Box>
        <Text size="2" color="gray">{position >= 0 ? `${position + 1} of ${lessons.length}` : ""}</Text>
      </div>

      <div className="player-body">
        <nav className="outline" aria-label="Lessons">
          {lessons.map((lesson, index) => (
            <Button
              key={lesson.id}
              type="button"
              variant={lesson.id === lessonId ? "solid" : "soft"}
              color={lesson.id === lessonId ? undefined : "gray"}
              onClick={() => {
                if (lesson.id === lessonId) return;
                stopSpeaking();
                window.location.hash = `#/course/${course.id}/lesson/${lesson.id}`;
              }}
            >
              {String(index + 1).padStart(2, "0")} {lesson.title}
            </Button>
          ))}
        </nav>

        <div className="player-stage">
          <div className="lesson-sheet">
            {phase === "loading" ? (
              <Box>
                <Badge color="gray" variant="soft">Preparing the lesson</Badge>
                <Heading size="8" my="3">{lessonMeta?.title || "One moment"}</Heading>
                <Text as="p" size="4" color="gray">I’m working out how to teach this from your notes.</Text>
              </Box>
            ) : null}

            {phase === "error" ? (
              <Box>
                <Badge color="red" variant="soft">Not ready</Badge>
                <Heading size="8" my="3">This lesson did not open</Heading>
                <Text as="p" size="4" mb="4">{error}</Text>
                <Button onClick={() => setRefreshKey((value) => value + 1)}>Try again</Button>
              </Box>
            ) : null}

            {phase === "beat" && beat ? (
              <article aria-live="polite">
                <Badge color="gray" variant="soft">{beat.eyebrow}</Badge>
                <Heading size="8" my="3">{beat.headline}</Heading>
                <Text as="p" size="4" style={{ lineHeight: 1.6 }}>{beat.narration}</Text>
                {beat.board?.length ? (
                  <Flex direction="column" gap="2" mt="4">
                    {beat.board.map((item) => (
                      <div className="note-card" key={item}>
                        <Text size="2">{item}</Text>
                      </div>
                    ))}
                  </Flex>
                ) : null}
                {beat.kind === "check" ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitQuestion(checkAnswer, "check");
                    }}
                  >
                    <Flex direction="column" gap="3" mt="5">
                      <label>
                        <Text as="div" size="2" mb="1" weight="medium">Your answer</Text>
                        <TextArea
                          rows={3}
                          value={checkAnswer}
                          onChange={(event) => setCheckAnswer(event.target.value)}
                          placeholder="Say it in your own words."
                        />
                      </label>
                      {beat.hint ? <Text size="2" color="gray">{beat.hint}</Text> : null}
                      <Flex gap="2" wrap="wrap">
                        <Button type="submit" disabled={asking || !checkAnswer.trim()}>
                          {asking ? "Listening…" : "That’s my answer"}
                        </Button>
                        {canListen() ? (
                          <Button type="button" variant="soft" color="gray" onClick={() => startListening("check")}>
                            {listening === "check" ? "Stop" : "Answer by voice"}
                          </Button>
                        ) : null}
                        <Button type="button" variant="ghost" color="gray" onClick={() => { setFeedback(null); const next = beatRef.current + 1; if (!script || next >= script.beats.length) finishLesson(); else play(next); }}>
                          Skip for now
                        </Button>
                      </Flex>
                    </Flex>
                  </form>
                ) : null}
                {speaking ? <Text as="p" size="1" color="gray" mt="3" weight="medium">Speaking</Text> : null}
                {differentModel ? (
                  <Button
                    mt="3"
                    variant="ghost"
                    onClick={() => {
                      refreshRef.current = true;
                      setRefreshKey((value) => value + 1);
                    }}
                  >
                    Retell this lesson with {models.selectedLabel}
                  </Button>
                ) : null}
              </article>
            ) : null}

            {phase === "bridge" ? (
              <Box>
                <Badge color="green" variant="soft">That’s the idea</Badge>
                <Heading size="8" my="3">{lessonMeta?.title}</Heading>
                <Text as="p" size="4" mb="4">
                  {bridgeTo ? `Next we’ll take ${bridgeTo.title}. ${bridgeTo.objective}` : "You can revisit any lesson from the path."}
                </Text>
                {bridgeTo ? (
                  <Button
                    size="3"
                    onClick={() => {
                      requestAutoplay();
                      window.location.hash = `#/course/${course.id}/lesson/${bridgeTo.id}`;
                    }}
                  >
                    Teach {bridgeTo.title}
                  </Button>
                ) : null}
              </Box>
            ) : null}

            {phase === "done" ? (
              <Box>
                <Badge color="green" variant="soft">The course</Badge>
                <Heading size="8" my="3">You’ve walked the whole path.</Heading>
                <Text as="p" size="4" mb="4">Every idea from the notes has had its turn. You can reopen any lesson and ask again.</Text>
                <Button size="3" onClick={onExit}>Back to the path</Button>
              </Box>
            ) : null}

            {feedback ? (
              <Box mt="4">
                <Callout.Root>
                  <Callout.Text>
                    <Text as="div" size="1" weight="medium" mb="2">{feedback.mode === "check" ? "On your answer" : "While we pause"}</Text>
                    <div className="rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(feedback.text || "…") }} />
                  </Callout.Text>
                </Callout.Root>
                {phase === "beat" ? (
                  <Button mt="3" onClick={() => play(beatRef.current)} disabled={asking}>Resume this idea</Button>
                ) : null}
              </Box>
            ) : null}

            {sourcesOpen && script?.sources?.length ? (
              <Box mt="4">
                <Heading size="4" mb="2">From your notes</Heading>
                {script.sources.map((source) => (
                  <Box key={`${source.documentId}-${source.page}`} mb="3">
                    <a href={`/api/courses/${course.id}/documents/${source.documentId}/file#page=${source.page}`}>
                      {source.documentName} · {source.unit} {source.page}
                    </a>
                    <Text as="p" size="2" color="gray" mt="1">{source.excerpt}</Text>
                  </Box>
                ))}
              </Box>
            ) : null}
          </div>
        </div>
      </div>

      {phase === "beat" && beat ? (
        <footer className="player-bar">
          <div className="player-controls">
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <Flex align="center" gap="3">
                <div className="steps" aria-label="Lesson steps">
                  {script.beats.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      data-current={index === beatIndex}
                      disabled={index > furthest}
                      aria-label={item.headline}
                      onClick={() => {
                        setFeedback(null);
                        play(index);
                      }}
                    />
                  ))}
                </div>
                <Button type="button" variant="soft" color="gray" onClick={() => play(beatIndex)}>Replay</Button>
                <Button type="button" variant="soft" color="gray" onClick={() => (paused ? play(beatIndex) : pause())}>
                  {paused ? "Resume" : "Pause"}
                </Button>
                {beat.kind !== "check" ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setFeedback(null);
                      const next = beatRef.current + 1;
                      if (!script || next >= script.beats.length) finishLesson();
                      else play(next);
                    }}
                  >
                    {beatIndex >= script.beats.length - 1 ? "Finish lesson" : "Continue"}
                  </Button>
                ) : null}
              </Flex>
              <Text size="1" color="gray">{script?.source === "live" ? script.modelLabel || "Live tutor" : "Drawn from your notes"}</Text>
            </Flex>
            <form
              className="ask-row"
              onSubmit={(event) => {
                event.preventDefault();
                submitQuestion(question, "interrupt");
              }}
            >
              <label className="sr-only" htmlFor="ask-box">Ask about this idea</label>
              <TextArea
                id="ask-box"
                rows={1}
                value={question}
                placeholder="Pause and ask about this idea…"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {canListen() ? (
                <Button type="button" variant="soft" color="gray" onClick={() => startListening("ask")}>
                  {listening === "ask" ? "Stop" : "Mic"}
                </Button>
              ) : null}
              <Button type="submit" disabled={!question.trim() || asking}>Ask</Button>
            </form>
            <Flex gap="2" wrap="wrap">
              <Button
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => {
                  const next = !voiceOn;
                  setVoiceOn(next);
                  localStorage.setItem("professor.voice", next ? "on" : "off");
                  if (!next) pause();
                }}
              >
                {canSpeak() ? (voiceOn ? "Voice on" : "Voice off") : "Voice unavailable"}
              </Button>
              <Button
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => {
                  const next = !autopilot;
                  setAutopilot(next);
                  localStorage.setItem("professor.autopilot", next ? "on" : "off");
                }}
              >
                {autopilot ? "Keeps going" : "I’ll tap continue"}
              </Button>
              <Button type="button" size="1" variant="ghost" color="gray" onClick={() => setSourcesOpen((value) => !value)}>
                {sourcesOpen ? "Hide notes" : "From your notes"}
              </Button>
            </Flex>
          </div>
        </footer>
      ) : null}
    </main>
  );
}
