import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { startRelay } from "../dist/index.js";
const bin = fileURLToPath(new URL("./fake-codex.js", import.meta.url));
async function setup(t, opts = {}) {
  const handle = await startRelay({
    port: 0,
    host: "127.0.0.1",
    cwd: process.cwd(),
    bin,
    token: "secret",
    ...opts,
  });
  t.after(() => handle.close());
  return { handle, url: `http://127.0.0.1:${handle.server.address().port}` };
}
async function connect(url, token = "secret") {
  const ws = new WebSocket(url.replace("http", "ws") + "/?token=" + token);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
function message(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No signaling response")),
      3000,
    );
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data));
    });
  });
}
test("authenticated SDP handshake returns an answer, never premature ready", async (t) => {
  const { url } = await setup(t);
  const ws = await connect(url);
  t.after(() => ws.terminate());
  const response = message(ws);
  ws.send(JSON.stringify({ type: "hello", sdp: "v=0\r\n" }));
  assert.deepEqual(await response, {
    type: "answer",
    threadId: "thread-fake-1",
    sdp: "v=0\r\nanswer",
  });
});
test("late startup rejection reaches phone as an error", async (t) => {
  const { url } = await setup(t);
  const ws = await connect(url);
  t.after(() => ws.terminate());
  const response = message(ws);
  ws.send(JSON.stringify({ type: "hello", sdp: "v=0\r\nreject" }));
  assert.match((await response).message, /voice unavailable/);
});
test("token is required and another website cannot use it", async (t) => {
  const { url } = await setup(t);
  await assert.rejects(connect(url, "wrong"), /401/);
  const ws = new WebSocket(url.replace("http", "ws") + "/?token=secret", {
    origin: "https://evil.example",
  });
  await assert.rejects(
    new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    /403/,
  );
});
test("shutdown finishes with a connected phone and startup in progress", async (t) => {
  const { url, handle } = await setup(t);
  const ws = await connect(url);
  t.after(() => ws.terminate());
  ws.send(JSON.stringify({ type: "hello", sdp: "v=0\r\nno-answer" }));
  await handle.close();
});
test("another controller cannot create a parallel coding session", async (t) => {
  const { url } = await setup(t);
  const first = await connect(url);
  t.after(() => first.terminate());
  await assert.rejects(connect(url), /409/);
});
test("static client is served without leaking the token in referrers", async (t) => {
  const { url } = await setup(t);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(await res.text(), /runny/);
  assert.equal((await fetch(url + "/package.json")).status, 404);
});
test("a busy port rejects startup", async (t) => {
  const { handle } = await setup(t);
  await assert.rejects(
    startRelay({
      port: handle.server.address().port,
      host: "127.0.0.1",
      cwd: process.cwd(),
    }),
    /EADDRINUSE/,
  );
});

test("reconnecting waits for the previous coding process to finish closing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "runny-shutdown-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const slowBin = join(directory, "slow-codex.mjs");
  await writeFile(
    slowBin,
    `#!/usr/bin/env node
import ${JSON.stringify(pathToFileURL(bin).href)};
process.stdin.once('end', () => setTimeout(() => {}, 500));
`,
    { mode: 0o755 },
  );
  const { url } = await setup(t, { bin: slowBin });
  const first = await connect(url);
  t.after(() => first.terminate());
  const answer = message(first);
  first.send(JSON.stringify({ type: "hello", sdp: "v=0\r\n" }));
  assert.equal((await answer).type, "answer");
  const disconnected = new Promise((resolve) => first.once("close", resolve));
  first.close();
  await disconnected;
  const reconnect = async () => {
    const next = await connect(url);
    t.after(() => next.terminate());
    return next;
  };
  await assert.rejects(reconnect(), /409/);
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await reconnect();
      return;
    } catch (err) {
      assert.match(err.message, /409/);
      assert.ok(
        Date.now() < deadline,
        "Relay should accept a controller after cleanup",
      );
      await delay(50);
    }
  }
});
