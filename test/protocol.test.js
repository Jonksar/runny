import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeClientMessage } from "../dist/index.js";
test("hello accepts an SDP offer without audio samples", () => {
  assert.deepEqual(decodeClientMessage('{"type":"hello","sdp":"v=0\\r\\n"}'), {
    type: "hello",
    sdp: "v=0\r\n",
  });
});
test("malformed and oversized offers are rejected", () => {
  for (const raw of [
    "null",
    "[]",
    "{",
    JSON.stringify({ type: "hello", sdp: "invalid" }),
    JSON.stringify({ type: "hello", sdp: "v=0" + "x".repeat(100_000) }),
  ]) {
    assert.equal(decodeClientMessage(raw), null);
  }
});
