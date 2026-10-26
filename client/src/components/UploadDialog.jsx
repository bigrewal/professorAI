import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { professorApi } from "../api.js";

const LEARNER_KEY = "professor.learner";
const STYLES = [
  { id: "examples", label: "Examples" },
  { id: "intuition", label: "Intuition" },
  { id: "precise", label: "Precise" },
];
const PACES = [
  { id: "steady", label: "Steady" },
  { id: "brisk", label: "Brisk" },
];

function loadLearner() {
  try {
    const value = JSON.parse(localStorage.getItem(LEARNER_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function learnerName() {
  const saved = loadLearner();
  return saved.name || "";
}

export function UploadDialog({ open, onOpenChange, onCreated }) {
  const saved = useMemo(loadLearner, [open]);
  const [title, setTitle] = useState("");
  const [name, setName] = useState(saved.name || "");
  const [background, setBackground] = useState(saved.background || "");
  const [style, setStyle] = useState(saved.style || "examples");
  const [pace, setPace] = useState(saved.pace || "steady");
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [maxUploadBytes, setMaxUploadBytes] = useState(50 * 1024 * 1024);
  useEffect(() => {
    professorApi.health().then((health) => setMaxUploadBytes(health.maxUploadBytes)).catch(() => {});
  }, []);

  function remember(next) {
    const learner = { name, background, style, pace, ...next };
    try { localStorage.setItem(LEARNER_KEY, JSON.stringify(learner)); } catch { /* Preferences are optional. */ }
  }

  function addFiles(list) {
    if (busy) return;
    const incoming = [...list].filter(Boolean);
    const invalid = incoming.find((file) => !/\.(pdf|txt|doc|docx|ppt|pptx)$/i.test(file.name));
    if (invalid) { setFormError(`${invalid.name}: choose a PDF, TXT, DOCX, or PPTX file.`); return; }
    if (incoming.some((file) => file.size > maxUploadBytes)) {
      setFormError(`Each file must be under ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`); return;
    }
    const next = [...files];
    for (const file of incoming) {
      if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    }
    if (next.length > 8) { setFormError("Choose up to 8 files per course."); return; }
    setFormError("");
    setFiles(next);
  }

  async function begin(event) {
    event.preventDefault();
    if (!title.trim() || !files.length || busy) return;
    setBusy(true);
    setFormError("");
    remember();
    const form = new FormData();
    for (const file of files) form.append("materials", file);
    form.append("title", title.trim());
    form.append("name", name);
    form.append("background", background);
    form.append("style", style);
    form.append("pace", pace);
    try {
      const payload = await professorApi.createCourse(form);
      setFiles([]);
      setTitle("");
      onOpenChange(false);
      await onCreated(payload.course);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "The upload did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Content maxWidth="560px" className="upload-dialog">
        <Dialog.Title>Start a course</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Turn your notes, PDFs, or slides into a personal lesson path. Add a little background so Professor can meet you where you are.
        </Dialog.Description>
        <form onSubmit={begin}>
          <fieldset disabled={busy} className="upload-fields">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">Course name</Text>
              <TextField.Root
                value={title}
                maxLength={80}
                placeholder="Calculus"
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1" weight="medium">Your name</Text>
              <TextField.Root
                value={name}
                maxLength={40}
                placeholder="Optional"
                onChange={(event) => {
                  setName(event.target.value);
                  remember({ name: event.target.value });
                }}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1" weight="medium">What you already know</Text>
              <TextArea
                rows={3}
                maxLength={500}
                placeholder="I know basic calculus, but limit notation is new."
                value={background}
                onChange={(event) => {
                  setBackground(event.target.value);
                  remember({ background: event.target.value });
                }}
              />
            </label>
            <div>
              <Text as="div" size="2" mb="2" weight="medium">How should I teach?</Text>
              <div className="choice-row">
                {STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="choice"
                    data-active={style === item.id}
                    aria-pressed={style === item.id}
                    onClick={() => {
                      setStyle(item.id);
                      remember({ style: item.id });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Text as="div" size="2" mb="2" weight="medium">Pace</Text>
              <div className="choice-row">
                {PACES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="choice"
                    data-active={pace === item.id}
                    aria-pressed={pace === item.id}
                    onClick={() => {
                      setPace(item.id);
                      remember({ pace: item.id });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <label
              className="dropzone"
              data-dragging={dragging}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,application/pdf,text/plain"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Text weight="medium">Drop your materials here, or browse</Text>
              <Text size="1" color="gray">PDF, TXT, DOCX, PPTX · up to 8 files · {Math.round(maxUploadBytes / 1024 / 1024)} MB each</Text>
            </label>
            {files.length ? (
              <Flex direction="column" gap="2">
                {files.map((file, index) => (
                  <div className="file-row" key={`${file.name}-${index}`}>
                    <Text size="2" className="file-name">{file.name}</Text>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setFiles(files.filter((_, item) => item !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </Flex>
            ) : null}
            {formError ? <Text role="alert" color="red" size="2">{formError}</Text> : null}
            {files.some((file) => /\.(doc|ppt)$/i.test(file.name)) ? (
              <Text size="1" color="gray">Older DOC and PPT files can be stored. To teach from them, first export as PDF, DOCX, or PPTX.</Text>
            ) : null}
            <Button className="ink-btn" size="3" type="submit" disabled={!title.trim() || !files.length || busy}>
              {busy ? "Reading the course…" : "Create course"}
            </Button>
            <button type="button" className="text-btn" onClick={() => onOpenChange(false)}>Cancel</button>
          </fieldset>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
