import { useState } from "react";
import { Box, Button, DropdownMenu, Flex, Text } from "@radix-ui/themes";

export function ModelSwitch({ catalog, onSelect }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <Button className="sign-in" variant="solid" disabled={!catalog || busy} aria-label="Tutor model">
          {label}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" style={{ width: 340 }}>
        <Box px="3" py="2">
          <Text size="1" color="gray">
            {catalog?.live ? "New explanations and replies use the tutor you select. Start a page fresh to replace its saved explanation." : "No LLM is connected. Add a provider API key in .env.local, then restart Professor. Grok uses XAI_API_KEY."}
          </Text>
          {error ? (
            <Text as="p" size="1" color="red" mt="2">
              {error}
            </Text>
          ) : null}
        </Box>
        {(catalog?.providers || []).map((provider) => (
          <DropdownMenu.Group key={provider.id}>
            <DropdownMenu.Label>
              <Flex justify="between" gap="3">
                <span>{provider.label}</span>
                <Text size="1" color="gray" weight="regular">
                  {provider.configured ? "Ready" : provider.env}
                </Text>
              </Flex>
            </DropdownMenu.Label>
            {provider.models.map((model) => (
              <DropdownMenu.Item
                key={model.id}
                disabled={!provider.configured || busy}
                onSelect={(event) => {
                  event.preventDefault();
                  choose(model.id);
                }}
              >
                <Flex direction="column" gap="1">
                  <Text size="2" weight="medium">
                    {model.label}
                    {model.id === catalog?.selected ? " · current" : ""}
                  </Text>
                  <Text size="1" color="gray">
                    {model.blurb}
                  </Text>
                </Flex>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Group>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
