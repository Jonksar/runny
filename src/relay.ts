import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { RealtimeSession, type SessionOptions } from "./session.js";
import { decodeClientMessage, encode, type ServerMessage } from "./protocol.js";

export interface RelayOptions extends Omit<SessionOptions, "sdp" | "signal"> {
  port: number;
  host: string;
  cwd: string;
  token?: string;
}
export interface RelayHandle {
  server: Server;
  close: () => Promise<void>;
}
const ASSETS: Record<string, string> = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/client.js": "text/javascript; charset=utf-8",
  "/manifest.webmanifest": "application/manifest+json",
};

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  if (
    !options.token &&
    !["127.0.0.1", "::1", "localhost"].includes(options.host)
  ) {
    throw new Error("A token is required when listening outside localhost");
  }
  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (!ASSETS[pathname]) {
      res.writeHead(404).end("not found");
      return;
    }
    const asset = pathname === "/" ? "index.html" : pathname.slice(1);
    void readFile(fileURLToPath(new URL(`../web/${asset}`, import.meta.url)))
      .then((body) => {
        res.writeHead(200, { "content-type": ASSETS[pathname]! }).end(body);
      })
      .catch(() => res.writeHead(404).end("not found"));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 70_000 });
  const cleanups = new Set<() => Promise<void>>();
  let shuttingDown = false;
  server.on("upgrade", (req, socket, head) => {
    const reject = (status: string) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      reject("400 Bad Request");
      return;
    }
    if (shuttingDown || cleanups.size > 0) {
      reject("409 Conflict");
      return;
    }
    if (url.pathname !== "/") {
      reject("404 Not Found");
      return;
    }
    if (options.token && url.searchParams.get("token") !== options.token) {
      reject("401 Unauthorized");
      return;
    }
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          reject("403 Forbidden");
          return;
        }
      } catch {
        reject("403 Forbidden");
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws));
  });

  function connect(ws: WebSocket): void {
    const controller = new AbortController();
    let session: RealtimeSession | undefined;
    let opening: Promise<void> | undefined;
    let alive = true;
    let cleaning: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 20_000);
    ws.on("pong", () => {
      alive = true;
    });
    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(encode(msg));
    };
    const fail = (err: unknown) => {
      send({
        type: "error",
        message: err instanceof Error ? err.message : "Voice connection failed",
      });
      ws.close(1011, "Voice connection failed");
      void cleanup();
    };
    function cleanup(): Promise<void> {
      if (cleaning) return cleaning;
      clearInterval(heartbeat);
      controller.abort();
      cleaning = (async () => {
        await opening;
        await session?.close();
        cleanups.delete(cleanup);
      })();
      return cleaning;
    }
    cleanups.add(cleanup);
    ws.on("close", () => {
      void cleanup();
    });
    ws.on("error", () => {
      void cleanup();
    });
    ws.on("message", (data, binary) => {
      if (controller.signal.aborted) return;
      if (binary) {
        fail(new Error("Audio must use WebRTC"));
        return;
      }
      const msg = decodeClientMessage(data.toString());
      if (!msg) {
        fail(new Error("Invalid signaling message"));
        return;
      }
      if (msg.type === "bye") {
        ws.close();
        void cleanup();
        return;
      }
      if (msg.type === "text") {
        if (!session) {
          fail(new Error("Voice is not connected"));
          return;
        }
        void session.appendText(msg.text).catch(fail);
        return;
      }
      if (opening) return;
      opening = RealtimeSession.open({
        ...options,
        sdp: msg.sdp,
        signal: controller.signal,
      })
        .then((opened) => {
          session = opened;
          if (controller.signal.aborted) return;
          opened.on("fault", fail);
          if (opened.failure) {
            fail(opened.failure);
            return;
          }
          send({ type: "answer", threadId: opened.threadId, sdp: opened.sdp });
        })
        .catch((err) => {
          if (!controller.signal.aborted) fail(err);
        });
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    wss.close();
    throw err;
  }
  let closing: Promise<void> | undefined;
  return {
    server,
    close: () => {
      if (closing) return closing;
      shuttingDown = true;
      closing = (async () => {
        for (const ws of wss.clients) ws.terminate();
        await Promise.all([...cleanups].map((cleanup) => cleanup()));
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })();
      return closing;
    },
  };
}
