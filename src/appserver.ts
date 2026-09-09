import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

export function defaultCodexBin(): string {
  for (const path of [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ]) {
    if (process.platform === "darwin" && existsSync(path)) return path;
  }
  return "codex";
}

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
  /** Deadline for each protocol request. Defaults to 30 seconds. */
  requestTimeoutMs?: number;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AppServerError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
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
  #requestTimeoutMs: number;

  private constructor(proc: ChildProcessWithoutNullStreams, timeoutMs: number) {
    super();
    this.#proc = proc;
    this.#requestTimeoutMs = timeoutMs;
    proc.on("error", (err) => this.#fail(err));
    proc.stdin.on("error", (err) => this.#fail(err));
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.#onStdout(chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    proc.on("exit", (code) => {
      this.#fail(new Error(`app-server exited (code ${code})`));
      this.emit("exit", code);
    });
  }

  /** Spawn the app server and complete the initialize handshake. */
  static async start(options: AppServerOptions = {}): Promise<AppServerClient> {
    const features = ["realtime_conversation", ...(options.features ?? [])];
    const args: string[] = [];
    for (const f of features) args.push("--enable", f);
    args.push("app-server");

    const proc = spawn(options.bin ?? defaultCodexBin(), args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    }) as ChildProcessWithoutNullStreams;

    const client = new AppServerClient(
      proc,
      options.requestTimeoutMs ?? 30_000,
    );
    try {
      await client.request("initialize", {
        clientInfo: {
          name: options.clientName ?? "runny",
          title: "runny",
          version: "0.2.0",
        },
        capabilities: { experimentalApi: true },
      });
      client.notify("initialized");
      return client;
    } catch (err) {
      await client.close();
      throw err;
    }
  }

  #fail(err: Error): void {
    this.#closed = true;
    for (const call of this.#pending.values()) {
      clearTimeout(call.timer);
      call.reject(err);
    }
    this.#pending.clear();
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

    if (!msg || typeof msg !== "object") return;
    // Request IDs are independent in each direction. Fail closed on requests
    // for permissions or interactive input instead of consuming a pending reply.
    if (typeof msg["method"] === "string" && msg["id"] !== undefined) {
      this.#proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg["id"],
          error: {
            code: -32601,
            message:
              "Runny cannot answer interactive requests. Use a local Codex session.",
          },
        }) + "\n",
      );
      this.emit("requestDenied", msg["method"]);
      return;
    }
    if (typeof msg["id"] === "number") {
      const call = this.#pending.get(msg["id"]);
      if (!call) return;
      this.#pending.delete(msg["id"]);
      clearTimeout(call.timer);
      const err = msg["error"] as
        | { code?: number; message?: string }
        | undefined;
      if (err) {
        call.reject(
          new AppServerError(
            err.code ?? -1,
            err.message ?? "unknown error",
            call.method,
          ),
        );
      } else {
        call.resolve(msg["result"]);
      }
      return;
    }

    if (typeof msg["method"] === "string") {
      this.emit("notification", msg["method"], msg["params"]);
      // The server sends notifications whose method is literally "error".
      // EventEmitter treats an "error" event with no listener as fatal and
      // throws, so route it somewhere that cannot take down the process.
      this.emit(
        msg["method"] === "error" ? "serverError" : msg["method"],
        msg["params"],
      );
    }
  }

  /** Send a request and await its result. */
  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("app-server is closed"));
    const id = this.#nextId++;
    const payload =
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(`${method} timed out after ${this.#requestTimeoutMs}ms`),
        );
      }, this.#requestTimeoutMs);
      this.#pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
        timer,
      });
      this.#proc.stdin.write(payload, (err) => {
        if (err) {
          this.#pending.delete(id);
          clearTimeout(timer);
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
    if (
      this.#proc.exitCode !== null ||
      this.#proc.signalCode !== null ||
      !this.#proc.pid
    )
      return;
    this.#fail(new Error("app-server is closed"));
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
