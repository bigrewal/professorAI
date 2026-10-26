import { createProviderRegistry, generateObject, streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";

export const registry = createProviderRegistry({
  xai,
  openai,
  anthropic,
  google,
});

function splitPrompt(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
  return { system: system || undefined, messages: conversation };
}

export function languageModel(modelId) {
  if (!modelId || !modelId.includes(":")) {
    throw new Error("Choose a tutor model before starting a live lesson.");
  }
  return registry.languageModel(modelId);
}

export async function completeObject({ schema, messages, modelId, maxOutputTokens = 2500, temperature = 0.4, timeoutMs = 90000 }) {
  const { system, messages: conversation } = splitPrompt(messages);
  const { object } = await generateObject({
    model: languageModel(modelId),
    schema,
    system,
    messages: conversation,
    maxOutputTokens,
    temperature,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return object;
}

export async function streamReply({ messages, modelId, onDelta, maxOutputTokens = 700, temperature = 0.5, timeoutMs = 45000 }) {
  const { system, messages: conversation } = splitPrompt(messages);
  const result = streamText({
    model: languageModel(modelId),
    system,
    messages: conversation,
    maxOutputTokens,
    temperature,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });

  let streamed = "";
  for await (const delta of result.textStream) {
    streamed += delta;
    onDelta(delta);
  }

  const finished = await result.text;
  return (finished || streamed).trim();
}
