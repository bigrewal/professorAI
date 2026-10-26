import { useState } from "react";
import { Button, DropdownMenu } from "@radix-ui/themes";
import { Icon } from "./icons.jsx";

export function ModelSwitch({ catalog, onSelect }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const provider = catalog?.providers?.find((item) => item.id === "xai");
  const label = catalog?.selectedLabel || "Notes only";

  async function choose(modelId) {
    if (modelId === catalog?.selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSelect(modelId);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The model could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); if (!next) setError(""); } }}>
      <DropdownMenu.Trigger>
        <Button className="sign-in model-trigger" variant="solid" disabled={!catalog || busy} aria-label="Tutor model">
          {label}<span aria-hidden="true" className="model-trigger-chevron">⌄</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" sideOffset={8} className="model-menu">
        <div className="model-menu-header">
          <span className="model-menu-eyebrow">YOUR TUTOR</span>
          <h2>Choose a Grok model</h2>
          <p>{provider?.configured ? "New explanations and replies use your selected model." : "Add XAI_API_KEY to .env.local, then restart Professor to use Grok."}</p>
        </div>
        <DropdownMenu.RadioGroup value={catalog?.selected || ""} onValueChange={choose}>
          {(provider?.models || []).map((model) => (
            <DropdownMenu.RadioItem key={model.id} value={model.id} className="model-option" disabled={!provider.configured || busy} onSelect={(event) => event.preventDefault()}>
              <div className="model-option-copy"><span className="model-option-name">{model.label}</span><span className="model-option-description">{model.blurb}</span></div>
              {model.id === catalog?.selected ? <span className="model-option-current"><Icon name="check" size={14} />Selected</span> : null}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        {error ? <p className="model-menu-error" role="alert">{error}</p> : null}
        {provider?.configured ? <p className="model-menu-footnote">Saved explanations stay the same until you start a page fresh.</p> : null}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
