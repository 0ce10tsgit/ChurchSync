import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { FRAME_SAMPLES } from "../audio/format.js";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 47474;

/** How long receivers hold audio before playing it; the broadcaster sets this for everyone. */
export const DEFAULT_DELAY_MS = 150;
export const MAX_DELAY_MS = 2000;

export function sanitizeDelay(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_DELAY_MS, Math.max(0, Math.round(value)))
    : DEFAULT_DELAY_MS;
}

/** Control channel (TCP): one JSON message per line. */
export type ControlMessage =
  | { type: "hello"; version: number; name: string; cnonce: string; udpPort: number }
  | { type: "challenge"; nonce: string }
  | { type: "auth"; hmac: string }
  | { type: "welcome"; sampleRate: number; channels: number; frameSamples: number; playing: boolean; delayMs: number; proof: string }
  | { type: "play"; playing: boolean }
  | { type: "delay"; delayMs: number }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number }
  | { type: "bye" };

export function encodeControl(msg: ControlMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decodeControl(line: string): ControlMessage | null {
  try {
    const msg = JSON.parse(line);
    return typeof msg?.type === "string" ? (msg as ControlMessage) : null;
  } catch {
    return null;
  }
}

/** Derive the shared key from the passphrase. Do this once at startup. */
export function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, "churchsync-v1", 32);
}

/**
 * Audio packet (UDP):
 *   0  version     (1)
 *   1  reserved    (1)
 *   2  sequence    (u32 BE)
 *   6  timestamp   (u32 BE, in samples)
 *  10  tag         (8, truncated HMAC-SHA256 of everything else, keyed by the PSK)
 *  18  Opus payload
 *
 * The passphrase never goes on the wire. A packet without a valid tag is dropped.
 */
export const HEADER_BYTES = 18;
const TAG_OFFSET = 10;
const TAG_BYTES = 8;
const MAX_OPUS_BYTES = 1275;

export interface AudioPacket {
  seq: number;
  timestamp: number;
  payload: Buffer;
}

function tagFor(key: Buffer, buf: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(buf.subarray(0, TAG_OFFSET))
    .update(buf.subarray(HEADER_BYTES))
    .digest()
    .subarray(0, TAG_BYTES);
}

export function encodeAudio({ seq, timestamp, payload }: AudioPacket, key: Buffer): Buffer {
  const buf = Buffer.alloc(HEADER_BYTES + payload.length);
  buf.writeUInt8(PROTOCOL_VERSION, 0);
  buf.writeUInt32BE(seq >>> 0, 2);
  buf.writeUInt32BE(timestamp >>> 0, 6);
  payload.copy(buf, HEADER_BYTES);
  tagFor(key, buf).copy(buf, TAG_OFFSET);
  return buf;
}

/** Returns null for anything malformed or with a bad tag, so callers can drop it. */
export function decodeAudio(buf: Buffer, key: Buffer): AudioPacket | null {
  if (buf.length <= HEADER_BYTES) return null;
  if (buf.length - HEADER_BYTES > MAX_OPUS_BYTES) return null;
  if (buf.readUInt8(0) !== PROTOCOL_VERSION) return null;
  const tag = buf.subarray(TAG_OFFSET, HEADER_BYTES);
  if (!timingSafeEqual(tag, tagFor(key, buf))) return null;
  return {
    seq: buf.readUInt32BE(2),
    timestamp: buf.readUInt32BE(6),
    payload: buf.subarray(HEADER_BYTES),
  };
}

/** Timestamp advance per packet. */
export const TIMESTAMP_STEP = FRAME_SAMPLES;
