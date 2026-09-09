/**
 * PCM helpers.
 *
 * Everything on the wire is signed 16-bit little-endian mono. The browser hands
 * us Float32 at whatever rate its AudioContext chose (usually 48000), and Codex
 * hands us chunks that carry their own `sampleRate`, so both directions need a
 * resample step. Nothing here allocates a worker or touches I/O, which keeps it
 * cheap to test.
 */

/** Clamp and convert normalised floats to signed 16-bit samples. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Convert signed 16-bit samples back to normalised floats. */
export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i] ?? 0;
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/**
 * Linear-interpolation resample.
 *
 * Good enough for speech and it costs nothing. A polyphase filter would sound
 * better on music, but we are shipping a voice that says "tests are green" over
 * a phone, so the extra fidelity buys nothing.
 */
export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate <= 0 || toRate <= 0) throw new RangeError("sample rates must be positive");
  if (fromRate === toRate || input.length === 0) return input;

  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const left = Math.floor(srcPos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcPos - left;
    const a = input[left] ?? 0;
    const b = input[right] ?? 0;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

/** Base64-encode PCM for the JSON-RPC `data` field. */
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.from(bytes).toString("base64");
}

/** Decode a base64 `data` field back into samples. */
export function base64ToPcm16(b64: string): Int16Array {
  const buf = Buffer.from(b64, "base64");
  // Buffer may not be 2-byte aligned within its pool, so copy rather than view.
  const copy = new Uint8Array(buf.byteLength - (buf.byteLength % 2));
  copy.set(buf.subarray(0, copy.length));
  return new Int16Array(copy.buffer);
}

/** Duration of a mono buffer, in milliseconds. */
export function durationMs(pcm: Int16Array, sampleRate: number): number {
  if (sampleRate <= 0) throw new RangeError("sample rate must be positive");
  return (pcm.length / sampleRate) * 1000;
}
