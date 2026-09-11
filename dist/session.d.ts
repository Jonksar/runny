import { EventEmitter } from "node:events";
import { type AppServerOptions } from "./appserver.js";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export declare const DEFAULT_MODEL = "gpt-6-astra";
export interface SessionOptions extends AppServerOptions {
    sdp: string;
    model?: string;
    voice?: string;
    sandbox?: SandboxMode;
    startupTimeoutMs?: number;
    signal?: AbortSignal;
}
/** A Codex thread plus its WebRTC signaling session. Audio stays off the relay. */
export declare class RealtimeSession extends EventEmitter {
    #private;
    readonly threadId: string;
    sdp: string;
    private constructor();
    get failure(): Error | null;
    static open(options: SessionOptions): Promise<RealtimeSession>;
    /** Add context. V3 does not treat appendText as a spoken user turn. */
    appendText(text: string): Promise<void>;
    close(): Promise<void>;
}
