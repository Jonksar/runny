import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { RealtimeSession } from "../dist/index.js";
const bin = fileURLToPath(new URL("./fake-codex.js", import.meta.url));
const open = (sdp = "v=0\r\n", extra = {}) =>
  RealtimeSession.open({ bin, sdp, startupTimeoutMs: 200, ...extra });

test("WebRTC open returns an SDP answer after the asynchronous notification", async () => {
  const session = await open();
  try {
    assert.equal(session.sdp, "v=0\r\nanswer");
    assert.equal(session.threadId, "thread-fake-1");
  } finally {
    await session.close();
  }
});
test("a realtime error after start acknowledgement rejects startup", async () => {
  await assert.rejects(open("v=0\r\nreject"), /voice unavailable/);
});
test("a missing SDP answer times out instead of reporting ready", async () => {
  await assert.rejects(open("v=0\r\nno-answer"), /timed out/);
});
test("cancel during startup releases the app-server", async () => {
  const controller = new AbortController();
  const pending = open("v=0\r\nno-answer", { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /abort/i);
});
