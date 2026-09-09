import { test } from "node:test";
import assert from "node:assert/strict";
import {
  floatToPcm16, pcm16ToFloat, resamplePcm16,
  pcm16ToBase64, base64ToPcm16, durationMs,
} from "../dist/audio.js";

test("float to pcm16 clamps beyond unit range", () => {
  const out = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]));
  assert.equal(out[0], 0);
  assert.equal(out[1], 32767);
  assert.equal(out[2], -32768);
  assert.equal(out[3], 32767, "values above 1 clamp rather than wrap");
  assert.equal(out[4], -32768, "values below -1 clamp rather than wrap");
});

test("pcm16 survives a float round trip within one LSB", () => {
  const original = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const back = floatToPcm16(pcm16ToFloat(original));
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(back[i] - original[i]) <= 1, `sample ${i}: ${back[i]} vs ${original[i]}`);
  }
});

test("resample returns the input untouched when rates match", () => {
  const input = new Int16Array([1, 2, 3]);
  assert.equal(resamplePcm16(input, 24000, 24000), input);
});

test("resample scales length by the rate ratio", () => {
  const input = new Int16Array(480);
  assert.equal(resamplePcm16(input, 48000, 24000).length, 240);
  assert.equal(resamplePcm16(input, 48000, 16000).length, 160);
  assert.equal(resamplePcm16(input, 24000, 48000).length, 960);
});

test("resample preserves a constant signal", () => {
  const input = new Int16Array(100).fill(5000);
  for (const s of resamplePcm16(input, 48000, 24000)) assert.equal(s, 5000);
});

test("resample rejects non-positive rates", () => {
  assert.throws(() => resamplePcm16(new Int16Array([1]), 0, 24000), RangeError);
  assert.throws(() => resamplePcm16(new Int16Array([1]), 24000, -1), RangeError);
});

test("resample handles an empty buffer", () => {
  assert.equal(resamplePcm16(new Int16Array(0), 48000, 24000).length, 0);
});

test("base64 round trip preserves samples", () => {
  const pcm = new Int16Array([0, -1, 1, 32767, -32768, 1234]);
  assert.deepEqual(Array.from(base64ToPcm16(pcm16ToBase64(pcm))), Array.from(pcm));
});

test("base64 decode drops a trailing odd byte instead of throwing", () => {
  const odd = Buffer.from([1, 2, 3]).toString("base64");
  assert.equal(base64ToPcm16(odd).length, 1);
});

test("duration converts samples to milliseconds", () => {
  assert.equal(durationMs(new Int16Array(24000), 24000), 1000);
  assert.equal(durationMs(new Int16Array(480), 24000), 20);
  assert.throws(() => durationMs(new Int16Array(1), 0), RangeError);
});
