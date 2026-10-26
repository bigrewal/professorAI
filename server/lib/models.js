const PROVIDERS = [
  {
    id: "xai",
    label: "xAI",
    env: "XAI_API_KEY",
    models: [
      { id: "grok-4.7", label: "Grok 4.7", blurb: "Newest Grok. Strong on long readings." },
      { id: "grok-4.5", label: "Grok 4.5", blurb: "A balance of depth and speed." },
      { id: "grok-4.3", label: "Grok 4.3", blurb: "Clear, steady explanations." },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", blurb: "A sharp general tutor." },
      { id: "gpt-5.4", label: "GPT-5.4", blurb: "Careful, structured teaching." },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", blurb: "Faster replies when you pause to ask." },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", blurb: "The most careful long-form tutor." },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", blurb: "Clear teaching at a lighter pace." },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", blurb: "Quick answers in the middle of a lesson." },
    ],
  },
  {
    id: "google",
    label: "Google",
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", blurb: "Fast, and comfortable with long notes." },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", blurb: "More deliberate reasoning." },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", blurb: "A steady everyday teacher." },
    ],
  },
];

function configured(provider) {
  return Boolean(String(process.env[provider.env] || "").trim());
}

export function modelCatalog(savedId = "") {
  const providers = PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    env: provider.env,
    configured: configured(provider),
    models: provider.models.map((model) => ({
      id: `${provider.id}:${model.id}`,
      label: model.label,
      blurb: model.blurb,
    })),
  }));

  const available = providers.flatMap((provider) => (provider.configured ? provider.models : []));
  let selected = "";
  if (savedId && available.some((model) => model.id === savedId)) {
    selected = savedId;
  } else {
    const preferred = process.env.TUTOR_MODEL || (process.env.XAI_MODEL ? `xai:${process.env.XAI_MODEL}` : "");
    selected = available.some((model) => model.id === preferred) ? preferred : available[0]?.id || "";
  }

  const current = available.find((model) => model.id === selected) || null;
  return {
    selected,
    selectedLabel: current?.label || "",
    live: Boolean(selected),
    providers,
  };
}

export function resolveModelId(savedId = "") {
  return modelCatalog(savedId).selected;
}

export function modelLabel(modelId) {
  if (!modelId) return "";
  for (const provider of PROVIDERS) {
    for (const model of provider.models) {
      if (`${provider.id}:${model.id}` === modelId) return model.label;
    }
  }
  return modelId;
}

export function assertSelectable(modelId) {
  const available = modelCatalog("").providers.flatMap((provider) => (provider.configured ? provider.models : []));
  if (!available.some((model) => model.id === modelId)) {
    throw Object.assign(new Error("Choose a model whose API key is configured."), { statusCode: 400 });
  }
  return modelId;
}
