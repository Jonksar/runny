import { EventEmitter } from "node:events";
import { AppServerClient } from "./appserver.js";
import { REALTIME_METHODS } from "./types.js";
export const DEFAULT_MODEL = "gpt-6-astra";
const INSTRUCTIONS = [
    "You are the backend coding executor for a hands-free voice conversation.",
    "Perform the requested work with your tools and report actual results.",
    "Prefix progress messages with [COMMENTARY] and the final result with [FINAL].",
    "Keep replies to two short sentences unless the user asks for detail.",
    "Do not claim work or tests succeeded before verifying them.",
].join(" ");
/** A Codex thread plus its WebRTC signaling session. Audio stays off the relay. */
export class RealtimeSession extends EventEmitter {
    threadId;
    sdp = "";
    #client;
    #closing = null;
    #fault = null;
    constructor(client, threadId) {
        super();
        this.#client = client;
        this.threadId = threadId;
        client.on("notification", (method, params) => {
            if (!params || params.threadId !== threadId)
                return;
            if (method === "thread/realtime/sdp" &&
                typeof params.sdp === "string") {
                this.sdp = params.sdp;
                this.emit("sdp", this.sdp);
                return;
            }
            if (method === "thread/realtime/error" || method === "error") {
                this.#fail(new Error(typeof params.message === "string"
                    ? params.message
                    : "Codex reported an error"));
                return;
            }
            if (method === "thread/realtime/closed")
                this.#fail(new Error("Codex closed the voice session"));
        });
        client.on("exit", () => {
            if (!this.#closing)
                this.#fail(new Error("Codex app-server exited"));
        });
        client.on("requestDenied", () => this.#fail(new Error("Codex needs interactive input. Continue this task locally.")));
    }
    #fail(err) {
        if (this.#fault || this.#closing)
            return;
        this.#fault = err;
        this.emit("fault", err);
    }
    get failure() {
        return this.#fault;
    }
    static async open(options) {
        options.signal?.throwIfAborted();
        if (!options.sdp.startsWith("v=0"))
            throw new Error("A WebRTC SDP offer is required");
        const client = await AppServerClient.start(options);
        let session;
        const abort = () => {
            void client.close();
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        try {
            options.signal?.throwIfAborted();
            const { thread } = await client.request("thread/start", {
                cwd: options.cwd ?? process.cwd(),
                model: options.model ?? DEFAULT_MODEL,
                sandbox: options.sandbox ?? "workspace-write",
                approvalPolicy: "never",
            });
            if (!thread?.id)
                throw new Error("thread/start returned no thread id");
            session = new RealtimeSession(client, thread.id);
            const opened = session;
            await new Promise((resolve, reject) => {
                const finish = (err) => {
                    clearTimeout(timer);
                    opened.off("sdp", answer);
                    opened.off("fault", fault);
                    options.signal?.removeEventListener("abort", cancelled);
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                };
                const answer = () => finish();
                const fault = (err) => finish(err);
                const cancelled = () => finish(new Error("Voice startup aborted"));
                const timer = setTimeout(() => finish(new Error("WebRTC SDP answer timed out")), options.startupTimeoutMs ?? 30_000);
                opened.once("sdp", answer);
                opened.once("fault", fault);
                options.signal?.addEventListener("abort", cancelled, { once: true });
                if (options.signal?.aborted) {
                    cancelled();
                    return;
                }
                void client
                    .request(REALTIME_METHODS.start, {
                    threadId: opened.threadId,
                    transport: { type: "webrtc", sdp: options.sdp },
                    version: "v3",
                    outputModality: "audio",
                    // The default thinking mode adds results as context without asking
                    // voice to speak. Route completed coding replies to speech instead.
                    codexResponseHandoffMode: "bemTags",
                    realtimeStartInstructions: INSTRUCTIONS,
                    ...(options.voice ? { voice: options.voice } : {}),
                })
                    .catch(fault);
            });
            options.signal?.throwIfAborted();
            if (opened.failure)
                throw opened.failure;
            return opened;
        }
        catch (err) {
            await (session ? session.close() : client.close());
            options.signal?.throwIfAborted();
            throw err;
        }
        finally {
            options.signal?.removeEventListener("abort", abort);
        }
    }
    /** Add context. V3 does not treat appendText as a spoken user turn. */
    async appendText(text) {
        if (this.#closing || this.#fault)
            throw new Error("Voice session is closed");
        if (!text.trim())
            return;
        await this.#client.request(REALTIME_METHODS.appendText, {
            threadId: this.threadId,
            text,
        });
    }
    close() {
        if (this.#closing)
            return this.#closing;
        this.#closing = this.#client.close();
        return this.#closing;
    }
}
//# sourceMappingURL=session.js.map