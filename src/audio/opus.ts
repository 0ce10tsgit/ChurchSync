import OpusScript from "opusscript";
import { CHANNELS, FRAME_BYTES, FRAME_SAMPLES, SAMPLE_RATE } from "./format.js";

/** Splits a PCM byte stream into 20ms Opus packets. */
export class OpusEncoder {
  private codec = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  private pending = Buffer.alloc(0);

  push(pcm: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, pcm]);
    const packets: Buffer[] = [];
    while (this.pending.length >= FRAME_BYTES) {
      const frame = this.pending.subarray(0, FRAME_BYTES);
      this.pending = this.pending.subarray(FRAME_BYTES);
      packets.push(Buffer.from(this.codec.encode(frame, FRAME_SAMPLES)));
    }
    return packets;
  }
}

export class OpusDecoder {
  private codec = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);

  decode(packet: Buffer): Buffer {
    return Buffer.from(this.codec.decode(packet));
  }
}
