import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeClientMessage, encode, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE } from "../dist/protocol.js";

test("hello decodes with a valid rate", () => {
  const msg = decodeClientMessage(JSON.stringify({ type: "hello", sampleRate: 48000 }));
  assert.deepEqual(msg, { type: "hello", sampleRate: 48000 });
});

test("hello carries optional voice and prompt", () => {
  const msg = decodeClientMessage(
    JSON.stringify({ type: "hello", sampleRate: 24000, voice: "marin", prompt: "hi" }),
  );
  assert.deepEqual(msg, { type: "hello", sampleRate: 24000, voice: "marin", prompt: "hi" });
});

test("hello rejects rates outside the supported band", () => {
  for (const rate of [MIN_SAMPLE_RATE - 1, MAX_SAMPLE_RATE + 1, 0, -48000, NaN]) {
    assert.equal(
      decodeClientMessage(JSON.stringify({ type: "hello", sampleRate: rate })), null,
      `rate ${rate} should be rejected`,
    );
  }
});

test("hello rounds a fractional rate", () => {
  const msg = decodeClientMessage(JSON.stringify({ type: "hello", sampleRate: 44100.7 }));
  assert.equal(msg.sampleRate, 44101);
});

test("malformed json yields null rather than throwing", () => {
  assert.equal(decodeClientMessage("{not json"), null);
  assert.equal(decodeClientMessage(""), null);
  assert.equal(decodeClientMessage("null"), null);
  assert.equal(decodeClientMessage("[]"), null);
});

test("unknown and empty messages are rejected", () => {
  assert.equal(decodeClientMessage(JSON.stringify({ type: "launch_missiles" })), null);
  assert.equal(decodeClientMessage(JSON.stringify({ type: "text", text: "" })), null);
  assert.equal(decodeClientMessage(JSON.stringify({ type: "text" })), null);
});

test("simple control messages decode", () => {
  assert.deepEqual(decodeClientMessage('{"type":"interrupt"}'), { type: "interrupt" });
  assert.deepEqual(decodeClientMessage('{"type":"bye"}'), { type: "bye" });
  assert.deepEqual(decodeClientMessage('{"type":"text","text":"run the tests"}'), {
    type: "text", text: "run the tests",
  });
});

test("encode produces parseable json", () => {
  const msg = { type: "ready", threadId: "t1", sampleRate: 48000, voice: "marin" };
  assert.deepEqual(JSON.parse(encode(msg)), msg);
});
