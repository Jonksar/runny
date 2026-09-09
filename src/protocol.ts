/**
 * Wire protocol between the phone and the relay.
 *
 * Binary frames carry raw PCM16 mono audio in both directions, because that is
 * the bulk of the traffic and JSON-wrapping it would waste a third of the
 * bandwidth on base64. Text frames carry JSON control messages. Direction is
 * implied by the sender, so there is no envelope on the audio path.
 */

import type { RealtimeVoice } from "./types.js";

/** Phone to relay. */
export type ClientMessage =
  | { type: "hello"; sampleRate: number; voice?: RealtimeVoice; prompt?: string }
  | { type: "text"; text: string }
  | { type: "bye" };

/** Relay to phone. */
export type ServerMessage =
  | { type: "ready"; threadId: string; sampleRate: number; voice: string }
  | { type: "transcript"; role: "user" | "agent"; text: string; done: boolean }
  | { type: "state"; state: AgentState }
  | { type: "error"; message: string };

/**
 * Coarse state for the phone UI. `thinking` covers the gap between the user
 * finishing a sentence and the first audio frame coming back, which is the
 * window where a runner will otherwise assume the thing has died.
 */
export type AgentState = "idle" | "listening" | "thinking" | "speaking";

export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 48000;

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse a control frame. Returns null rather than throwing, because a phone on
 * a flaky connection will occasionally deliver garbage and dropping one frame
 * is always better than tearing down the session mid-run.
 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const msg = parsed as Record<string, unknown>;

  switch (msg["type"]) {
    case "hello": {
      const rate = msg["sampleRate"];
      if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
      if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) return null;
      const out: ClientMessage = { type: "hello", sampleRate: Math.round(rate) };
      if (typeof msg["voice"] === "string") out.voice = msg["voice"] as RealtimeVoice;
      if (typeof msg["prompt"] === "string") out.prompt = msg["prompt"];
      return out;
    }
    case "text": {
      const text = msg["text"];
      if (typeof text !== "string" || text.length === 0) return null;
      return { type: "text", text };
    }
    case "bye":
      return { type: "bye" };
    default:
      return null;
  }
}
