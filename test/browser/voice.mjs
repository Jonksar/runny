import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { startRelay } from "../../dist/index.js";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.RUNNY_BROWSER_CHANNEL
    ? { channel: process.env.RUNNY_BROWSER_CHANNEL }
    : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
let relay;
const upstream = await browser.newPage();
let rejectOffer = false;
const peerServer = createServer((req, res) => {
  let offer = "";
  req.on("data", (chunk) => {
    offer += chunk;
  });
  req.on("end", () => {
    if (rejectOffer) {
      res.writeHead(503).end("Voice unavailable for this account");
      return;
    }
    void upstream
      .evaluate(async (sdp) => {
        window.peer?.close();
        const pc = new RTCPeerConnection();
        window.peer = pc;
        pc.ondatachannel = ({ channel }) => {
          window.events = channel;
          channel.onopen = () =>
            channel.send(
              JSON.stringify({
                type: "turn.done",
                turn: {
                  role: "assistant",
                  transcript: "Local voice connection verified.",
                },
              }),
            );
        };
        await pc.setRemoteDescription({ type: "offer", sdp });
        const ctx = new AudioContext();
        window.audioContext = ctx;
        await ctx.resume();
        const tone = ctx.createOscillator();
        const output = ctx.createMediaStreamDestination();
        tone.connect(output);
        tone.start();
        pc.addTrack(output.stream.getAudioTracks()[0], output.stream);
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc.iceGatheringState !== "complete")
          await new Promise((resolve) => {
            pc.addEventListener("icegatheringstatechange", () => {
              if (pc.iceGatheringState === "complete") resolve();
            });
          });
        return pc.localDescription.sdp;
      }, offer)
      .then((sdp) => res.end(sdp))
      .catch((err) => res.writeHead(500).end(err.message));
  });
});
try {
  await new Promise((resolve) => peerServer.listen(0, "127.0.0.1", resolve));
  process.env.RUNNY_FAKE_PEER = `http://127.0.0.1:${peerServer.address().port}`;
  relay = await startRelay({
    port: 0,
    host: "127.0.0.1",
    cwd: process.cwd(),
    token: "browser-test",
    bin: new URL("../fake-codex.js", import.meta.url).pathname,
  });
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  await upstream.goto(origin);
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    permissions: ["microphone"],
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/#token=browser-test`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("state").textContent === "Connected",
    null,
    { timeout: 15_000 },
  );
  await page.getByText("Local voice connection verified.").waitFor();
  await page.waitForFunction(
    () => document.querySelector("audio").currentTime > 0.2,
  );
  const received = await upstream.evaluate(async () => {
    const stats = await window.peer.getStats();
    return [...stats.values()].some(
      (s) =>
        s.type === "inbound-rtp" && s.kind === "audio" && s.bytesReceived > 0,
    );
  });
  assert.equal(
    received,
    true,
    "upstream must receive real WebRTC microphone packets",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  if (process.env.RUNNY_SCREENSHOT)
    await page.screenshot({ path: process.env.RUNNY_SCREENSHOT });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  assert.equal(await page.locator("#state").textContent(), "Ready to connect");
  await page.waitForFunction(
    () => document.querySelector("audio").srcObject === null,
  );
  await relay.close();
  // A fresh relay makes reconnection deterministic without sleeping for process teardown.
  relay = await startRelay({
    port: Number(new URL(origin).port),
    host: "127.0.0.1",
    cwd: process.cwd(),
    token: "browser-test",
    bin: new URL("../fake-codex.js", import.meta.url).pathname,
  });
  rejectOffer = true;
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById("state").className === "error",
  );
  assert.match(await page.locator("#state").textContent(), /Voice unavailable/);
  assert.equal(
    await page.getByRole("button", { name: "Start", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser WebRTC audio both ways, transcript, Stop, reconnect failure, mobile layout, no page errors",
  );
} finally {
  await relay?.close();
  peerServer.closeAllConnections();
  await new Promise((resolve) => peerServer.close(resolve));
  delete process.env.RUNNY_FAKE_PEER;
  await browser.close();
}
