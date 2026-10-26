import assert from "node:assert/strict";
import { test } from "node:test";
import { streamPageExplanation } from "../server/lib/tutor.js";
import { modelCatalog } from "../server/lib/models.js";

test("page tutoring selects fast Grok by default and sends the intended reasoning setting", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.XAI_API_KEY;
  const oldTutor = process.env.TUTOR_MODEL;
  const oldModel = process.env.XAI_MODEL;
  process.env.XAI_API_KEY = "test-key";
  delete process.env.TUTOR_MODEL;
  delete process.env.XAI_MODEL;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const events = [
      { id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { content: "A clear explanation." }, finish_reason: null }] },
      { id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  try {
    assert.equal(modelCatalog().selected, "xai:grok-4.3");
    assert.equal(modelCatalog("xai:grok-4.7").selected, "xai:grok-4.7");
    process.env.TUTOR_MODEL = "xai:grok-4.5";
    assert.equal(modelCatalog().selected, "xai:grok-4.5");
    const page = { label: "page 1", text: "Limits describe an approaching value." };
    for (const modelId of ["xai:grok-4.3", "xai:grok-4.7"]) {
      const deltas = [];
      const answer = await streamPageExplanation({ page, learner: {}, history: [], modelId, live: true }, (text) => deltas.push(text));
      assert.equal(answer, "A clear explanation.");
      assert.equal(deltas.join(""), answer);
    }
    assert.equal(calls[0].reasoning_effort, "none");
    assert.equal(calls[1].reasoning_effort, "low");
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of [["XAI_API_KEY", oldKey], ["TUTOR_MODEL", oldTutor], ["XAI_MODEL", oldModel]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
