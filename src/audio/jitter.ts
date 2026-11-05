import { performance } from "node:perf_hooks";
import { FRAME_MS } from "./format.js";

/** What the playout loop should do for one 20 ms slot. */
export type Frame =
  | { kind: "audio"; payload: Buffer }
  | { kind: "lost" } // packet missing: let the decoder conceal it
  | { kind: "silence" }; // nothing to play (still filling the buffer)

export interface JitterStats {
  /** packets waiting to be played */
  depth: number;
  /** arrived after their slot had passed */
  late: number;
  /** slots with no packet */
  lost: number;
  /** discarded to keep latency from creeping up */
  dropped: number;
  /** times the buffer ran dry and had to refill */
  underruns: number;
}

/** A sequence gap bigger than this (5 s) means the broadcaster restarted. */
const MAX_JUMP_FRAMES = 250;
/** After this many missing slots in a row (200 ms) stop concealing and refill. */
const MAX_CONSECUTIVE_LOST = 10;
/** Backlog tolerated above the target before frames are dropped to catch up. */
const CATCHUP_SLACK_FRAMES = 5;

/** Signed, wraparound-safe distance from b to a for 32-bit sequence numbers. */
const ahead = (a: number, b: number) => (a - b) | 0;

const framesFor = (delayMs: number) => Math.max(1, Math.ceil(delayMs / FRAME_MS));

/**
 * Holds incoming packets, puts them in order, and hands them out one per 20 ms slot.
 * Playback starts once `delayMs` worth of audio is stored.
 */
export class JitterBuffer {
  private frames = new Map<number, Buffer>();
  private targetFrames: number;
  private nextSeq = 0;
  private newest = 0;
  private playing = false;
  private consecutiveLost = 0;
  private counters = { late: 0, lost: 0, dropped: 0, underruns: 0 };

  constructor(delayMs: number) {
    this.targetFrames = framesFor(delayMs);
  }

  push(seq: number, payload: Buffer) {
    seq >>>= 0;
    if (this.playing || this.frames.size) {
      const d = ahead(seq, this.playing ? this.nextSeq : this.newest);
      if (Math.abs(d) > MAX_JUMP_FRAMES) this.flush();
      else if (this.playing && d < 0) {
        this.counters.late++;
        return;
      }
    }
    if (this.frames.has(seq)) return;
    this.frames.set(seq, payload);
    if (this.frames.size === 1 || ahead(seq, this.newest) > 0) this.newest = seq;
  }

  /** Call once per 20 ms slot. */
  pull(): Frame {
    if (!this.playing) {
      if (this.frames.size < this.targetFrames) return { kind: "silence" };
      this.nextSeq = this.oldest();
      this.playing = true;
      this.consecutiveLost = 0;
    }

    this.catchUp();
    const payload = this.frames.get(this.nextSeq);
    this.frames.delete(this.nextSeq);
    this.nextSeq = (this.nextSeq + 1) >>> 0;

    if (payload) {
      this.consecutiveLost = 0;
      return { kind: "audio", payload };
    }
    this.counters.lost++;
    if (++this.consecutiveLost > MAX_CONSECUTIVE_LOST) {
      this.counters.underruns++;
      this.flush();
      return { kind: "silence" };
    }
    return { kind: "lost" };
  }

  /** A larger delay needs a refill to build the extra cushion; a smaller one drains by catching up. */
  setDelay(delayMs: number) {
    const target = framesFor(delayMs);
    if (target > this.targetFrames && this.playing) this.flush();
    this.targetFrames = target;
  }

  /** Drop everything and refill, e.g. when a muted receiver is unmuted so it plays live audio. */
  flush() {
    this.frames.clear();
    this.playing = false;
    this.consecutiveLost = 0;
  }

  stats(): JitterStats {
    return { depth: this.frames.size, ...this.counters };
  }

  private oldest(): number {
    let best: number | undefined;
    for (const seq of this.frames.keys()) {
      if (best === undefined || ahead(seq, best) < 0) best = seq;
    }
    return best as number;
  }

  private catchUp() {
    while (ahead(this.newest, this.nextSeq) > this.targetFrames + CATCHUP_SLACK_FRAMES) {
      this.frames.delete(this.nextSeq);
      this.nextSeq = (this.nextSeq + 1) >>> 0;
      this.counters.dropped++;
    }
  }
}

/**
 * Calls `onFrame` every 20 ms with the next slot from the buffer.
 * Each tick is scheduled against the start time, so timer error doesn't build up.
 * Returns a function that stops it.
 */
export function startPlayout(buffer: JitterBuffer, onFrame: (frame: Frame) => void): () => void {
  const start = performance.now();
  let ticks = 0;
  let timer: NodeJS.Timeout;

  const tick = () => {
    onFrame(buffer.pull());
    ticks++;
    timer = setTimeout(tick, Math.max(0, start + (ticks + 1) * FRAME_MS - performance.now()));
  };
  timer = setTimeout(tick, FRAME_MS);
  return () => clearTimeout(timer);
}
