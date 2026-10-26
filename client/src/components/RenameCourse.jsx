import { useEffect, useState } from "react";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { professorApi } from "../api.js";

export function RenameCourse({ course, onRenamed }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setTitle(course.title); setError(""); } }, [open, course.title]);

  async function save(event) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { course: renamed } = await professorApi.renameCourse(course.id, title.trim());
      onRenamed(renamed);
      setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <Dialog.Trigger><button type="button" className="text-btn rename-course" aria-label={`Rename ${course.title}`}>Rename</button></Dialog.Trigger>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Rename course</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">Choose a name that makes this course easy to find.</Dialog.Description>
        <form onSubmit={save}>
          <label><Text as="div" size="2" weight="medium" mb="2">Course name</Text>
            <TextField.Root value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={busy} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Flex justify="end" gap="3" mt="4">
            <Button type="button" variant="soft" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="ink-btn" disabled={!title.trim() || busy}>{busy ? "Saving…" : "Save name"}</Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
