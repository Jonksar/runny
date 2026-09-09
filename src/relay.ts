import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { RealtimeSession, type SandboxMode } from "./session.js";
import { decodeClientMessage, encode, type ServerMessage } from "./protocol.js";
import type { RealtimeVoice } from "./types.js";

const WEB_ROOT = fileURLToPath(new URL("../web", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

export interface RelayOptions {
  port: number;
  host: string;
  cwd: string;
  voice?: RealtimeVoice;
  model?: string;
  sandbox?: SandboxMode;
  /** Shared secret required as ?token=... on the socket URL. */
  token?: string;
}

export interface RelayHandle {
  server: Server;
  close: () => Promise<void>;
}

export function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const server = createServer((req, res) => {
    void serveStatic(req.url ?? "/", res);
  });

  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Set<RealtimeSession>();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (options.token && url.searchParams.get("token") !== options.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    void handleConnection(ws, options, sessions);
  });

  return new Promise((resolve) => {
    server.listen(options.port, options.host, () => {
      resolve({
        server,
        close: async () => {
          for (const s of sessions) await s.close().catch(() => {});
          sessions.clear();
          wss.close();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

async function handleConnection(
  ws: WebSocket,
  options: RelayOptions,
  sessions: Set<RealtimeSession>,
): Promise<void> {
  let session: RealtimeSession | null = null;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  };

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!session) return;
      // Copy out of the pooled buffer before reinterpreting as samples.
      const bytes = new Uint8Array(data.byteLength - (data.byteLength % 2));
      bytes.set(data.subarray(0, bytes.length));
      void session.appendAudio(new Int16Array(bytes.buffer)).catch((err: Error) => {
        send({ type: "error", message: err.message });
      });
      return;
    }

    const msg = decodeClientMessage(data.toString("utf8"));
    if (!msg) return;

    switch (msg.type) {
      case "hello": {
        if (session) return;
        void openSession(msg.sampleRate, msg.voice, msg.prompt);
        return;
      }
      case "text":
        void session?.appendText(msg.text);
        return;
      case "interrupt":
        // Codex handles barge-in server-side once new audio arrives; this is
        // here so the phone can signal it explicitly on a tap.
        void session?.appendText("[user interrupted]");
        return;
      case "bye":
        ws.close();
        return;
    }
  });

  ws.on("close", () => {
    if (session) {
      sessions.delete(session);
      void session.close().catch(() => {});
      session = null;
    }
  });

  async function openSession(
    sampleRate: number,
    voice?: RealtimeVoice,
    prompt?: string,
  ): Promise<void> {
    try {
      const opened = await RealtimeSession.open({
        cwd: options.cwd,
        clientSampleRate: sampleRate,
        voice: voice ?? options.voice,
        model: options.model,
        sandbox: options.sandbox,
        prompt,
      });
      session = opened;
      sessions.add(opened);

      opened.on("audio", (pcm: Int16Array) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), { binary: true });
        }
      });
      opened.on("transcript", (role: "user" | "agent", text: string, done: boolean) => {
        send({ type: "transcript", role, text, done });
      });
      opened.on("error", (err: Error) => send({ type: "error", message: err.message }));
      opened.on("closed", (reason: string) => {
        send({ type: "error", message: reason });
        ws.close();
      });

      send({
        type: "ready",
        threadId: opened.threadId,
        sampleRate,
        voice: voice ?? options.voice ?? "marin",
      });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      ws.close();
    }
  }
}

async function serveStatic(
  urlPath: string,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const clean = normalize(urlPath.split("?")[0] ?? "/").replace(/^(\.\.[/\\])+/, "");
  const file = clean === "/" || clean === "" ? "index.html" : clean.replace(/^\//, "");
  const full = join(WEB_ROOT, file);

  if (!full.startsWith(WEB_ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

export type { IncomingMessage };
