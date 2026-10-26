import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSse } from '../client/src/api.js';

function response(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

test('SSE delivers partial text while the response is still open', async () => {
  let controller;
  const stream = new Response(new ReadableStream({ start(value) { controller = value; } }));
  const encoder = new TextEncoder();
  const deltas = [];
  let done = false;
  let firstDelta;
  const received = new Promise((resolve) => { firstDelta = resolve; });
  const reading = readSse(stream, {
    onDelta(value) { deltas.push(value); firstDelta(); },
    onDone() { done = true; },
  });
  controller.enqueue(encoder.encode('event: delta\ndata: {"delta":"First words"}\n\n'));
  try {
    await received;
    assert.deepEqual(deltas, ['First words']);
    assert.equal(done, false);
    controller.enqueue(encoder.encode('event: delta\ndata: {"delta":" arrive live."}\n\nevent: done\ndata: {"text":"First words arrive live."}\n\n'));
  } finally {
    controller.close();
    await reading;
  }
  assert.equal(deltas.join(''), 'First words arrive live.');
  assert.equal(done, true);
});

test('SSE handles CRLF boundaries split across network chunks', async () => {
  const deltas = [];
  let done;
  await readSse(response(['event: delta\r', '\ndata: {"delta":"Hello"}\r', '\n\r', '\nevent: done\r\ndata: {"text":"Hello"}\r\n\r\n']), {
    onDelta: (value) => deltas.push(value), onDone: (value) => { done = value; },
  });
  assert.deepEqual(deltas, ['Hello']);
  assert.equal(done, 'Hello');
});

test('SSE reports a final error even without a trailing event separator', async () => {
  await assert.rejects(readSse(response(['event: error\ndata: {"error":"Tutor unavailable"}']), {}), /Tutor unavailable/);
});

test('SSE rejects interrupted answers instead of treating them as complete', async () => {
  await assert.rejects(readSse(response(['event: delta\ndata: {"delta":"Partial"}\n\n']), {}), /before the tutor finished/);
});

test('SSE releases the reader after a callback fails', async () => {
  const stream = response(['event: done\ndata: {"text":"Done"}\n\n']);
  await assert.rejects(readSse(stream, { onDone: () => { throw new Error('Callback failed'); } }), /Callback failed/);
  assert.equal(stream.body.locked, false);
});
