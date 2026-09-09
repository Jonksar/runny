import { EventEmitter } from "node:events";
import { AppServerClient, type AppServerOptions } from "./appserver.js";
import { base64ToPcm16, pcm16ToBase64, resamplePcm16 } from "./audio.js";
import {
  REALTIME_METHODS,
  REALTIME_NOTIFICATIONS,
  type RealtimeVoice,
  type RealtimeVoicesList,
  type ThreadRealtimeAudioChunk,
  type ThreadRealtimeOutputAudioDeltaNotification,
  type ThreadRealtimeStartedNotification,
} from "./types.js";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface SessionOptions extends AppServerOptions {
  voice?: RealtimeVoice;
  model?: string;
  /**
   * Defaults to workspace-write. You cannot tap approve while running, so the
   * sandbox is the only thing standing between a misheard sentence and your
   * working tree. Widen it deliberately or not at all.
   */
  sandbox?: SandboxMode;
  /** Sample rate the phone is sending and expects back. */
  clientSampleRate: number;
  /** Spoken by the agent when the session opens. */
  startInstructions?: string;
  prompt?: string;
}

export interface SessionEvents {
  audio: (pcm: Int16Array, sampleRate: number) => void;
  transcript: (role: "user" | "agent", text: string, done: boolean) => void;
  closed: (reason: string) => void;
  error: (err: Error) => void;
}

const DEFAULT_START_INSTRUCTIONS = [
  "You are being spoken to by someone who is running, outdoors, at pace.",
  "They cannot look at a screen and cannot type.",
  "Keep every reply under two sentences unless they ask for detail.",
  "Never read code, diffs, file paths, or tables aloud. Summarise them instead.",
  "Delegate all real work to the coding agent rather than answering from memory.",
].join(" ");

/**
 * One realtime voice conversation bound to one Codex thread.
 *
 * Codex owns the hard parts: the model connection, reconnect backoff, and the
 * handoff to the coding agent. This class only moves audio across the boundary
 * and resamples it, since the phone and the model rarely agree on a rate.
 */
export class RealtimeSession extends EventEmitter {
  #client: AppServerClient;
  #threadId: string;
  #clientRate: number;
  #modelRate: number | null = null;
  #stopped = false;

  private constructor(client: AppServerClient, threadId: string, clientRate: number) {
    super();
    this.#client = client;
    this.#threadId = threadId;
    this.#clientRate = clientRate;
    this.#wire();
  }

  get threadId(): string {
    return this.#threadId;
  }

  static async open(options: SessionOptions): Promise<RealtimeSession> {
    const client = await AppServerClient.start(options);

    const thread = await client.request<{ threadId?: string; thread?: { id?: string } }>(
      "thread/start",
      {
        cwd: options.cwd ?? process.cwd(),
        sandbox: options.sandbox ?? "workspace-write",
        ...(options.model ? { model: options.model } : {}),
      },
    );

    const threadId = thread.threadId ?? thread.thread?.id;
    if (!threadId) {
      await client.close();
      throw new Error("thread/start returned no threadId");
    }

    const session = new RealtimeSession(client, threadId, options.clientSampleRate);

    await client.request(REALTIME_METHODS.start, {
      threadId,
      transport: "websocket",
      voice: options.voice ?? "marin",
      realtimeStartInstructions: options.startInstructions ?? DEFAULT_START_INSTRUCTIONS,
      ...(options.prompt ? { prompt: options.prompt } : {}),
    });

    return session;
  }

  #wire(): void {
    this.#client.on(REALTIME_NOTIFICATIONS.started, (params: unknown) => {
      const p = params as ThreadRealtimeStartedNotification;
      this.emit("started", p.realtimeSessionId, p.version);
    });

    this.#client.on(REALTIME_NOTIFICATIONS.outputAudioDelta, (params: unknown) => {
      const p = params as ThreadRealtimeOutputAudioDeltaNotification;
      if (p.threadId !== this.#threadId) return;
      this.#modelRate = p.audio.sampleRate;
      const pcm = base64ToPcm16(p.audio.data);
      const out = resamplePcm16(pcm, p.audio.sampleRate, this.#clientRate);
      this.emit("audio", out, this.#clientRate);
    });

    this.#client.on(REALTIME_NOTIFICATIONS.transcriptDelta, (params: unknown) => {
      const p = params as { threadId: string; delta: string; role?: string };
      if (p.threadId !== this.#threadId) return;
      this.emit("transcript", p.role === "user" ? "user" : "agent", p.delta, false);
    });

    this.#client.on(REALTIME_NOTIFICATIONS.transcriptDone, (params: unknown) => {
      const p = params as { threadId: string; text: string; role?: string };
      if (p.threadId !== this.#threadId) return;
      this.emit("transcript", p.role === "user" ? "user" : "agent", p.text, true);
    });

    this.#client.on(REALTIME_NOTIFICATIONS.error, (params: unknown) => {
      const p = params as { message?: string };
      this.emit("error", new Error(p.message ?? "realtime error"));
    });

    this.#client.on(REALTIME_NOTIFICATIONS.closed, () => {
      this.#stopped = true;
      this.emit("closed", "remote closed the realtime session");
    });
  }

  /** Push microphone audio. Resampled to whatever rate the model last used. */
  async appendAudio(pcm: Int16Array): Promise<void> {
    if (this.#stopped || pcm.length === 0) return;
    const targetRate = this.#modelRate ?? this.#clientRate;
    const resampled = resamplePcm16(pcm, this.#clientRate, targetRate);
    const audio: ThreadRealtimeAudioChunk = {
      data: pcm16ToBase64(resampled),
      sampleRate: targetRate,
      numChannels: 1,
      samplesPerChannel: resampled.length,
      itemId: null,
    };
    await this.#client.request(REALTIME_METHODS.appendAudio, { threadId: this.#threadId, audio });
  }

  /** Inject typed text as if it had been spoken. */
  async appendText(text: string): Promise<void> {
    if (this.#stopped) return;
    await this.#client.request(REALTIME_METHODS.appendText, { threadId: this.#threadId, text });
  }

  /** Speak text verbatim without asking the model. */
  async speak(text: string): Promise<void> {
    if (this.#stopped) return;
    await this.#client.request(REALTIME_METHODS.appendSpeech, { threadId: this.#threadId, text });
  }

  async listVoices(): Promise<RealtimeVoicesList> {
    return this.#client.request<RealtimeVoicesList>(REALTIME_METHODS.listVoices, {});
  }

  async close(): Promise<void> {
    if (!this.#stopped) {
      this.#stopped = true;
      try {
        await this.#client.request(REALTIME_METHODS.stop, { threadId: this.#threadId });
      } catch {
        // The session may already be gone. Tearing down is best effort.
      }
    }
    await this.#client.close();
  }
}
