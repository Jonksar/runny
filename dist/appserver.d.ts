import { EventEmitter } from "node:events";
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
