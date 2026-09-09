import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

/**
 * Newline-delimited JSON-RPC client for `codex app-server`.
 *
 * Two things are easy to get wrong and both cost a confusing error:
 *   - the realtime methods need `--enable realtime_conversation`, since the
 *     feature is off by default
 *   - `initialize` must declare `experimentalApi`, or every realtime call comes
 *     back as -32600 "requires experimentalApi capability"
 * Both are handled here so callers cannot forget.
 */

export interface AppServerOptions {
  /** Path to the codex binary. */
  bin?: string;
  /** Working directory for the agent. Defaults to the current directory. */
  cwd?: string;
  /** Extra feature flags beyond realtime_conversation. */
  features?: string[];
  /** Client name reported in the handshake. */
  clientName?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export class AppServerError extends Error {
  constructor(readonly code: number, message: string, readonly method: string) {
    super(`${method} failed (${code}): ${message}`);
    this.name = "AppServerError";
  }
}

export class AppServerClient extends EventEmitter {
  #proc: ChildProcessWithoutNullStreams;
  #pending = new Map<number, PendingCall>();
  #nextId = 1;
  #stdoutBuffer = "";
  #closed = false;

  private constructor(proc: ChildProcessWithoutNullStreams) {
    super();
    this.#proc = proc;
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.#onStdout(chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    proc.on("exit", (code) => {
      this.#closed = true;
      for (const [, call] of this.#pending) {
        call.reject(new Error(`app-server exited (code ${code}) before ${call.method} returned`));
      }
      this.#pending.clear();
      this.emit("exit", code);
    });
  }

  /** Spawn the app server and complete the initialize handshake. */
  static async start(options: AppServerOptions = {}): Promise<AppServerClient> {
    const features = ["realtime_conversation", ...(options.features ?? [])];
    const args: string[] = [];
    for (const f of features) args.push("--enable", f);
    args.push("app-server");

    const proc = spawn(options.bin ?? "codex", args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const client = new AppServerClient(proc);
    await client.request("initialize", {
      clientInfo: {
        name: options.clientName ?? "runny",
        title: "runny",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    client.notify("initialized");
    return client;
  }

  #onStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.#stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.#stdoutBuffer.slice(0, newline).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.#handleLine(line);
    }
  }

  #handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit("malformed", line);
      return;
    }

    if (typeof msg["id"] === "number") {
      const call = this.#pending.get(msg["id"]);
      if (!call) return;
      this.#pending.delete(msg["id"]);
      const err = msg["error"] as { code?: number; message?: string } | undefined;
      if (err) {
        call.reject(new AppServerError(err.code ?? -1, err.message ?? "unknown error", call.method));
      } else {
        call.resolve(msg["result"]);
      }
      return;
    }

    if (typeof msg["method"] === "string") {
      this.emit("notification", msg["method"], msg["params"]);
      this.emit(msg["method"], msg["params"]);
    }
  }

  /** Send a request and await its result. */
  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("app-server is closed"));
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      this.#proc.stdin.write(payload, (err) => {
        if (err) {
          this.#pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Send a notification. No reply is expected. */
  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) body["params"] = params;
    this.#proc.stdin.write(JSON.stringify(body) + "\n");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#proc.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#proc.kill("SIGKILL");
        resolve();
      }, 3000);
      this.#proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
