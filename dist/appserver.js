import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
/**
 * Oldest Codex known to hold a WebRTC realtime call.
 *
 * The client sends an `openai-alpha: quicksilver=vN` header when opening one,
 * and older builds send a value the backend rejects with
 * `AVAS requires OpenAI-Alpha: quicksilver=v2`. Observed failing on 0.149.1
 * and working on 0.153.4. The failure arrives asynchronously, after
 * `thread/realtime/start` has already returned success, so it reads as a hang.
 */
export const MIN_REALTIME_CODEX = "0.153.0";
/** Numeric dotted-version compare. Missing parts count as zero. */
export function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0)
            return d < 0 ? -1 : 1;
    }
    return 0;
}
/** Pull a dotted version out of `codex --version` output. */
export function parseVersion(output) {
    return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}
export function defaultCodexBin() {
    for (const path of [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
    ]) {
        if (process.platform === "darwin" && existsSync(path))
            return path;
    }
    return "codex";
}
export class AppServerError extends Error {
    code;
    method;
    constructor(code, message, method) {
        super(`${method} failed (${code}): ${message}`);
        this.code = code;
        this.method = method;
        this.name = "AppServerError";
    }
}
export class AppServerClient extends EventEmitter {
    #proc;
    #pending = new Map();
    #nextId = 1;
    #stdoutBuffer = "";
    #closed = false;
    #requestTimeoutMs;
    constructor(proc, timeoutMs) {
        super();
        this.#proc = proc;
        this.#requestTimeoutMs = timeoutMs;
        proc.on("error", (err) => this.#fail(err));
        proc.stdin.on("error", (err) => this.#fail(err));
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (chunk) => this.#onStdout(chunk));
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", (chunk) => this.emit("stderr", chunk));
        proc.on("exit", (code) => {
            this.#fail(new Error(`app-server exited (code ${code})`));
            this.emit("exit", code);
        });
    }
    /** Spawn the app server and complete the initialize handshake. */
    static async start(options = {}) {
        const features = ["realtime_conversation", ...(options.features ?? [])];
        const args = [];
        for (const f of features)
            args.push("--enable", f);
        args.push("app-server");
        const proc = spawn(options.bin ?? defaultCodexBin(), args, {
            cwd: options.cwd ?? process.cwd(),
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env,
        });
        const client = new AppServerClient(proc, options.requestTimeoutMs ?? 30_000);
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
        }
        catch (err) {
            await client.close();
            throw err;
        }
    }
    #fail(err) {
        this.#closed = true;
        for (const call of this.#pending.values()) {
            clearTimeout(call.timer);
            call.reject(err);
        }
        this.#pending.clear();
    }
    #onStdout(chunk) {
        this.#stdoutBuffer += chunk;
        let newline;
        while ((newline = this.#stdoutBuffer.indexOf("\n")) !== -1) {
            const line = this.#stdoutBuffer.slice(0, newline).trim();
            this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
            if (line.length > 0)
                this.#handleLine(line);
        }
    }
    #handleLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            this.emit("malformed", line);
            return;
        }
        if (!msg || typeof msg !== "object")
            return;
        // Request IDs are independent in each direction. Fail closed on requests
        // for permissions or interactive input instead of consuming a pending reply.
        if (typeof msg["method"] === "string" && msg["id"] !== undefined) {
            this.#proc.stdin.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg["id"],
                error: {
                    code: -32601,
                    message: "Runny cannot answer interactive requests. Use a local Codex session.",
                },
            }) + "\n");
            this.emit("requestDenied", msg["method"]);
            return;
        }
        if (typeof msg["id"] === "number") {
            const call = this.#pending.get(msg["id"]);
            if (!call)
                return;
            this.#pending.delete(msg["id"]);
            clearTimeout(call.timer);
            const err = msg["error"];
            if (err) {
                call.reject(new AppServerError(err.code ?? -1, err.message ?? "unknown error", call.method));
            }
            else {
                call.resolve(msg["result"]);
            }
            return;
        }
        if (typeof msg["method"] === "string") {
            this.emit("notification", msg["method"], msg["params"]);
            // The server sends notifications whose method is literally "error".
            // EventEmitter treats an "error" event with no listener as fatal and
            // throws, so route it somewhere that cannot take down the process.
            this.emit(msg["method"] === "error" ? "serverError" : msg["method"], msg["params"]);
        }
    }
    /** Send a request and await its result. */
    request(method, params = {}) {
        if (this.#closed)
            return Promise.reject(new Error("app-server is closed"));
        const id = this.#nextId++;
        const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error(`${method} timed out after ${this.#requestTimeoutMs}ms`));
            }, this.#requestTimeoutMs);
            this.#pending.set(id, {
                resolve: resolve,
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
    notify(method, params) {
        if (this.#closed)
            return;
        const body = { jsonrpc: "2.0", method };
        if (params !== undefined)
            body["params"] = params;
        this.#proc.stdin.write(JSON.stringify(body) + "\n");
    }
    async close() {
        if (this.#proc.exitCode !== null ||
            this.#proc.signalCode !== null ||
            !this.#proc.pid)
            return;
        this.#fail(new Error("app-server is closed"));
        this.#proc.stdin.end();
        await new Promise((resolve) => {
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
//# sourceMappingURL=appserver.js.map