const stateEl = document.getElementById("state");
const logEl = document.getElementById("log");
const button = document.getElementById("go");
const audio = document.getElementById("audio");
const url = new URL(location.href);
const token =
  new URLSearchParams(url.hash.slice(1)).get("token") ??
  url.searchParams.get("token");
// Keep the access token out of subsequent HTTP requests and browser referrers.
if (url.searchParams.has("token")) {
  url.searchParams.delete("token");
  url.hash = new URLSearchParams({ token }).toString();
  history.replaceState(null, "", url);
}
let current = null;
function state(label, kind = "idle") {
  stateEl.textContent = label;
  stateEl.className = kind;
}
function line(text, role = "sys") {
  const el = document.createElement("div");
  el.className = `line ${role}`;
  el.textContent = text;
  logEl.append(el);
  while (logEl.children.length > 100) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
function stop(message = "Ready to connect", failed = false) {
  const call = current;
  current = null;
  if (call) {
    clearTimeout(call.timer);
    clearTimeout(call.disconnectTimer);
    call.ws?.close();
    call.pc?.close();
    call.stream?.getTracks().forEach((track) => track.stop());
    void call.wakeLock?.release().catch(() => {});
  }
  audio.pause();
  audio.srcObject = null;
  button.textContent = "Start";
  button.classList.remove("stop");
  state(message, failed ? "error" : "idle");
  if (failed) line(message);
}
function checkReady(call) {
  if (
    current !== call ||
    call.pc.connectionState !== "connected" ||
    call.channel.readyState !== "open"
  )
    return;
  clearTimeout(call.timer);
  state("Connected", "listening");
}
function event(call, raw) {
  if (current !== call) return;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === "error") {
    stop(msg.error?.message ?? "Voice service error", true);
    return;
  }
  if (msg.type === "turn.done" && typeof msg.turn?.transcript === "string") {
    line(msg.turn.transcript, msg.turn.role === "user" ? "user" : "agent");
    state("Connected", "listening");
    return;
  }
  if (msg.type === "delegation.created") {
    state("Coding", "thinking");
    return;
  }

  if (msg.type === "input_audio_buffer.speech_started") {
    state("Listening", "listening");
    return;
  }
  if (msg.type === "response.created") {
    state("Thinking", "thinking");
    return;
  }
  if (msg.type === "output_audio_buffer.started") {
    state("Speaking", "speaking");
    return;
  }
  if (
    msg.type === "output_audio_buffer.stopped" ||
    msg.type === "output_audio_buffer.cleared"
  ) {
    state("Connected", "listening");
    return;
  }
  if (msg.type === "conversation.item.input_audio_transcription.completed")
    line(msg.transcript, "user");
  if (
    msg.type === "response.output_audio_transcript.done" ||
    msg.type === "response.audio_transcript.done"
  )
    line(msg.transcript, "agent");
}
async function start() {
  if (current) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    stop("Microphone access needs HTTPS. Open the secure tunnel URL.", true);
    return;
  }
  const call = {};
  current = call;
  button.textContent = "Cancel";
  button.classList.add("stop");
  state("Connecting", "thinking");
  call.timer = setTimeout(() => {
    if (current === call)
      stop("Connection timed out. Check Codex and try again.", true);
  }, 45_000);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (current !== call) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    call.stream = stream;
    const pc = new RTCPeerConnection();
    call.pc = pc;
    pc.ontrack = (ev) => {
      if (current !== call) return;
      audio.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
      void audio.play().catch(() => {
        if (current === call)
          stop("Audio playback was blocked. Tap Start to try again.", true);
      });
    };
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const channel = pc.createDataChannel("oai-events");
    call.channel = channel;
    channel.onopen = () => checkReady(call);
    channel.onmessage = (ev) => event(call, ev.data);
    channel.onclose = () => {
      if (current === call)
        stop("Voice data connection closed. Tap Start to reconnect.", true);
    };
    pc.onconnectionstatechange = () => {
      if (current !== call) return;
      if (pc.connectionState === "failed") {
        stop("Audio connection failed. Tap Start to reconnect.", true);
        return;
      }
      if (pc.connectionState === "disconnected") {
        state("Reconnecting", "thinking");
        clearTimeout(call.disconnectTimer);
        call.disconnectTimer = setTimeout(() => {
          if (current === call)
            stop("Audio connection lost. Tap Start to reconnect.", true);
        }, 10_000);
        return;
      }
      if (pc.connectionState === "connected") {
        clearTimeout(call.disconnectTimer);
        checkReady(call);
      }
    };
    await pc.setLocalDescription(await pc.createOffer());
    if (current !== call) return;
    const socketUrl = new URL(location.href);
    socketUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.hash = "";
    socketUrl.search = "";
    socketUrl.pathname = "/";
    if (token) socketUrl.searchParams.set("token", token);
    const ws = new WebSocket(socketUrl);
    call.ws = ws;
    ws.onopen = () => {
      if (current === call)
        ws.send(
          JSON.stringify({ type: "hello", sdp: pc.localDescription.sdp }),
        );
    };
    ws.onmessage = async (ev) => {
      if (current !== call) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "error") {
          stop(msg.message, true);
          return;
        }
        if (msg.type !== "answer") return;
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        if (current !== call) return;
        button.textContent = "Stop";
        checkReady(call);
      } catch (err) {
        if (current === call) stop(err.message, true);
      }
    };
    ws.onerror = () => {
      if (current === call)
        stop("Relay connection failed. Check the URL and access token.", true);
    };
    ws.onclose = () => {
      if (current === call)
        stop("Relay disconnected. Tap Start to reconnect.", true);
    };
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (current !== call) {
        await lock?.release();
        return;
      }
      call.wakeLock = lock;
    } catch {
      /* A wake lock is optional and cannot guarantee background audio. */
    }
  } catch (err) {
    if (current === call) stop(err.message, true);
  }
}
button.addEventListener("click", () => (current ? stop() : void start()));
window.addEventListener("pagehide", () => stop());
document.addEventListener("visibilitychange", async () => {
  const call = current;
  if (document.visibilityState !== "visible" || !call) return;
  try {
    const lock = await navigator.wakeLock?.request("screen");
    if (current === call) call.wakeLock = lock;
    else await lock?.release();
  } catch {}
});
