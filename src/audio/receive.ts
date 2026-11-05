import { Writable } from "node:stream";
import { listenForAudio } from "../shared/udp.js";
import { FRAME_BYTES } from "./format.js";
import { JitterBuffer, JitterStats, startPlayout } from "./jitter.js";
import { OpusDecoder } from "./opus.js";
import { openPlayback } from "./playback.js";

export interface ReceiverOptions {
  port: number;
  /** the broadcaster's address; UDP from anywhere else is ignored */
  allowedIp: string;
  key: Buffer;
  delayMs: number;
  playing: boolean;
  onError: (err: Error) => void;
  /** where decoded PCM goes; defaults to a PipeWire playback stream */
  output?: Writable;
}

export interface AudioReceiver {
  setPlaying(playing: boolean): void;
  setDelay(delayMs: number): void;
  stats(): JitterStats & { packets: number };
  stop(): void;
}

const MAX_QUEUED_BYTES = FRAME_BYTES * 25; // 500 ms; beyond this, playback is stuck and new audio is dropped

/** Listens for audio packets and plays them through a jitter buffer. */
export function startReceiving(opts: ReceiverOptions): AudioReceiver {
  let output = opts.output;
  if (!output) {
    try {
      output = openPlayback();
    } catch (err) {
      // keep receiving so the buffer stats still work, but there's nowhere to play it
      opts.onError(err as Error);
      output = new Writable({ write: (_chunk, _enc, done) => done() });
    }
  }
  output.on("error", opts.onError);
  const sink = output;

  const jitter = new JitterBuffer(opts.delayMs);
  const decoder = new OpusDecoder();
  const silence = Buffer.alloc(FRAME_BYTES);
  let playing = opts.playing;
  let packets = 0;

  const socket = listenForAudio(
    opts.port,
    opts.allowedIp,
    opts.key,
    ({ seq, payload }) => {
      packets++;
      if (playing) jitter.push(seq, payload);
    },
    opts.onError,
  );

  // always write something each slot, so the playback stream never starves
  const stopPlayout = startPlayout(jitter, (frame) => {
    if (sink.writableLength > MAX_QUEUED_BYTES) return;
    if (frame.kind === "audio") {
      try {
        return void sink.write(decoder.decode(frame.payload));
      } catch {
        // a payload that won't decode is treated like a lost packet
      }
    }
    sink.write(silence);
  });

  return {
    setPlaying(value) {
      playing = value;
      if (!value) jitter.flush();
    },
    setDelay: (delayMs) => jitter.setDelay(delayMs),
    stats: () => ({ ...jitter.stats(), packets }),
    stop() {
      stopPlayout();
      socket.close();
      sink.end();
    },
  };
}
