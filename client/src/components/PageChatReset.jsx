import { useState } from "react";
import { Button, Dialog, Flex } from "@radix-ui/themes";
import { professorApi } from "../api.js";

export function PageChatReset({ courseId, page, disabled, onReset }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function clear() {
    setBusy(true);
    setError("");
    try {
      const result = await professorApi.resetPageChat(courseId, page.documentId, page.number);
      onReset(result);
      setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) { setError(""); setOpen(next); } }}>
    <Dialog.Trigger><button type="button" className="text-btn" disabled={disabled} aria-label={`Start fresh on ${page.label}`}>Start fresh</button></Dialog.Trigger>
    <Dialog.Content maxWidth="440px">
      <Dialog.Title>Start this page again?</Dialog.Title>
      <Dialog.Description size="2" color="gray">Clear the chat and saved explanation for {page.label} of {page.documentName}. Its explained mark will reset. Your course learning memory will remain.</Dialog.Description>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Flex justify="end" gap="3" mt="5"><Button type="button" variant="soft" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="button" className="ink-btn" disabled={busy} onClick={clear}>{busy ? "Clearing…" : "Clear page chat"}</Button></Flex>
    </Dialog.Content>
  </Dialog.Root>;
}
