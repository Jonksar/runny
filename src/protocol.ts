/** Phone/relay signaling only. WebRTC carries audio directly. */
export type ClientMessage =
  | { type: "hello"; sdp: string }
  | { type: "text"; text: string }
  | { type: "bye" };
export type ServerMessage =
  | { type: "answer"; threadId: string; sdp: string }
  | { type: "error"; message: string };
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
export function decodeClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const msg = value as Record<string, unknown>;
  if (msg.type === "bye") return { type: "bye" };
  if (
    msg.type === "hello" &&
    typeof msg.sdp === "string" &&
    msg.sdp.startsWith("v=0") &&
    msg.sdp.length <= 65_536
  ) {
    return { type: "hello", sdp: msg.sdp };
  }
  if (
    msg.type === "text" &&
    typeof msg.text === "string" &&
    msg.text.trim() &&
    msg.text.length <= 8_192
  ) {
    return { type: "text", text: msg.text };
  }
  return null;
}
