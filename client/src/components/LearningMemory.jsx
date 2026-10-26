import { useEffect, useState } from "react";
import { Button, Dialog, Flex, Text, TextArea } from "@radix-ui/themes";
import { professorApi } from "../api.js";

export function LearningMemory({ course, page, disabled, onSaved }) {
  const [open, setOpen] = useState(false);
  const [background, setBackground] = useState("");
  const [memory, setMemory] = useState("");
  const [useRecent, setUseRecent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setBackground(course.learner?.background || "");
    setMemory(course.learner?.memory || "");
    setUseRecent(course.learner?.useRecentQuestions !== false);
    setError("");
  }, [open]);

  const recent = (course.chat || []).filter((message) => message.role === "student" && message.kind === "question" && message.text?.trim()
    && (message.documentId !== page.documentId || message.page !== page.number)).slice(-6).reverse();

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await professorApi.saveLearner(course.id, { background, memory, useRecentQuestions: useRecent });
      onSaved(result.course);
      setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <Dialog.Trigger><button type="button" className="text-btn" disabled={disabled}>Learning memory</button></Dialog.Trigger>
    <Dialog.Content maxWidth="520px" className="learning-memory-dialog">
      <Dialog.Title>Learning memory</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="4">These course notes and selected questions are sent to your connected tutor with new requests. You can change or clear them anytime.</Dialog.Description>
      <form onSubmit={save}>
        <label><Text as="div" size="2" weight="medium" mb="1">Your background</Text><TextArea value={background} maxLength={600} rows={3} disabled={busy} onChange={(event) => setBackground(event.target.value)} placeholder="What do you already know?" /></label>
        <label><Text as="div" size="2" weight="medium" mt="3" mb="1">What should the tutor remember?</Text><TextArea value={memory} maxLength={1200} rows={3} disabled={busy} onChange={(event) => setMemory(event.target.value)} placeholder="For example: I find proofs by induction confusing." /></label>
        <label className="memory-checkbox"><input type="checkbox" checked={useRecent} disabled={busy} onChange={(event) => setUseRecent(event.target.checked)} /> Use recent questions from other pages as context</label>
        <p className="memory-hint">The tutor uses up to six recent questions still in your course chat. Questions aren’t treated as proof of understanding. Starting a page fresh removes its questions from this list.</p>
        {recent.length ? <details className="memory-recent"><summary>Recent questions from other pages ({recent.length})</summary><ul>{recent.map((item) => <li key={item.id}><strong>{course.documents?.find((document) => document.id === item.documentId)?.originalName || "Document"} · page {item.page}</strong><span>{item.text.slice(0, 400)}</span></li>)}</ul></details> : <p className="memory-hint">No questions from other pages yet.</p>}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Flex justify="end" gap="3" mt="4"><Button type="button" variant="soft" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className="ink-btn" disabled={busy}>{busy ? "Saving…" : "Save memory"}</Button></Flex>
      </form>
    </Dialog.Content>
  </Dialog.Root>;
}
