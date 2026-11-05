import dgram from "node:dgram";
import { Readable } from "node:stream";
import { encodeAudio } from "../shared/protocol.js";
import { capture } from "./capture.js";
import { FRAME_SAMPLES } from "./format.js";
import { OpusEncoder } from "./opus.js";

export interface SendTarget {
  address: string;
  udpPort: number;
}

export interface SenderOptions {
  key: Buffer;
  /** who to send to right now; called for every packet */
  targets: () => SendTarget[];
  onError: (err: Error) => void;
  /** raw s16le 48 kHz stereo PCM; defaults to capturing from the audio system */
  input?: Readable;
}

export interface Sender {
  /** `level` is the loudest sample since the last call, 0 to 1 */
  stats(): { packets: number; level: number };
  stop(): void;
}

/** Captures audio, Opus-encodes it in 20 ms frames, and sends each frame to every target. */
export function startSending({ key, targets, onError, input }: SenderOptions): Sender {
  let source: Readable;
  try {
    source = input ?? capture();
  } catch (err) {
    onError(err as Error);
    return { stats: () => ({ packets: 0, level: 0 }), stop() {} };
  }

  const socket = dgram.createSocket("udp4");
  socket.on("error", onError);
  const encoder = new OpusEncoder();
  let seq = 0;
  let packets = 0;
  let peak = 0;

  source.on("error", onError);
  source.on("data", (pcm: Buffer) => {
    for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    for (const payload of encoder.push(pcm)) {
      const packet = encodeAudio({ seq, timestamp: seq * FRAME_SAMPLES, payload }, key);
      seq = (seq + 1) >>> 0;
      packets++;
      // a receiver that vanished mid-send isn't an error worth surfacing
      for (const t of targets()) socket.send(packet, t.udpPort, t.address, () => {});
    }
  });

  return {
    stats() {
      const level = peak / 32768;
      peak = 0;
      return { packets, level };
    },
    stop() {
      source.destroy();
      socket.close();
    },
  };
}
