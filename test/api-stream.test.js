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
