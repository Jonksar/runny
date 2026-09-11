import { EventEmitter } from "node:events";
/**
 * Oldest Codex known to hold a WebRTC realtime call.
 *
 * The client sends an `openai-alpha: quicksilver=vN` header when opening one,
 * and older builds send a value the backend rejects with
 * `AVAS requires OpenAI-Alpha: quicksilver=v2`. Observed failing on 0.149.1
 * and working on 0.153.4. The failure arrives asynchronously, after
 * `thread/realtime/start` has already returned success, so it reads as a hang.
 */
export declare const MIN_REALTIME_CODEX = "0.153.0";
/** Numeric dotted-version compare. Missing parts count as zero. */
export declare function compareVersions(a: string, b: string): number;
/** Pull a dotted version out of `codex --version` output. */
export declare function parseVersion(output: string): string | null;
export declare function defaultCodexBin(): string;
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
export declare class AppServerError extends Error {
    readonly code: number;
    readonly method: string;
    constructor(code: number, message: string, method: string);
}
export declare class AppServerClient extends EventEmitter {
    #private;
    private constructor();
    /** Spawn the app server and complete the initialize handshake. */
    static start(options?: AppServerOptions): Promise<AppServerClient>;
    /** Send a request and await its result. */
    request<T = unknown>(method: string, params?: unknown): Promise<T>;
    /** Send a notification. No reply is expected. */
    notify(method: string, params?: unknown): void;
    close(): Promise<void>;
}
