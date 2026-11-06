import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import { options } from "../options.js";
import { CHANNELS, SAMPLE_RATE } from "./format.js";
import { nodeProps } from "./pipewire.js";

export interface CaptureOptions {
  /** PipeWire node name or id; omit for the default source */
  target?: string;
  /** capture a sink's output (monitor) instead of an input */
  monitor?: boolean;
}

/** Raw s16le PCM, 48 kHz stereo: from PipeWire via pw-cat, or from WASAPI with --win. */
export function capture(opts: CaptureOptions = {}): Readable {
  if (options.win) return captureWebAudio(options.winDevice);
  if (process.platform !== "linux") {
    throw new Error("audio capture needs PipeWire on Linux; on Windows run with --win (debug)");
  }
  return capturePipeWire(opts);
}

function capturePipeWire({ target, monitor }: CaptureOptions): Readable {
  const args = [
    "--record",
    "--raw",
    "--format", "s16",
    "--rate", String(SAMPLE_RATE),
    "--channels", String(CHANNELS),
  ];
  if (target) args.push("--target", target);
  const extra: Record<string, string> = monitor ? { "stream.capture.sink": "true" } : {};
  args.push("-P", nodeProps("ChurchSync-Send", "ChurchSync Send", extra), "-");

  const proc = spawn("pw-cat", args, { stdio: ["ignore", "pipe", "inherit"] });
  proc.on("error", (err) => proc.stdout.destroy(err));
  proc.stdout.on("close", () => proc.kill());
  return proc.stdout;
}

// Just the parts of node-web-audio-api we use. The package is an optional dependency,
// so it's loaded by name at runtime and the build doesn't depend on it being installed.
interface InputDevice {
  kind: string;
  label: string;
  deviceId: string;
}
/** This version's input stream is opaque; closing the audio context is the only way to release it. */
type MediaStreamLike = object;
interface AudioNodeLike {
  connect(to: unknown): void;
}
interface WebAudio {
  AudioContext: new (opts: { sampleRate: number }) => {
    destination: unknown;
    createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
    createScriptProcessor(
      size: number,
      inputs: number,
      outputs: number,
    ): AudioNodeLike & {
      onaudioprocess:
        | ((e: { inputBuffer: { getChannelData(ch: number): Float32Array } }) => void)
        | null;
    };
    createGain(): AudioNodeLike & { gain: { value: number } };
    close(): Promise<void>;
  };
  mediaDevices: {
    enumerateDevices(): Promise<InputDevice[]>;
    getUserMedia(constraints: {
      audio: true | { deviceId: string };
    }): Promise<MediaStreamLike>;
  };
}

const toS16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)));

/** Debug capture via the OS audio API (WASAPI on Windows). */
function captureWebAudio(deviceName?: string): Readable {
  const out = new PassThrough();
  let stop = () => {};
  out.on("close", () => stop());

  (async () => {
    const moduleName = "node-web-audio-api";
    const webAudio = (await import(moduleName).catch(() => {
      throw new Error("--win needs the optional package node-web-audio-api (npm install)");
    })) as WebAudio;
    const { AudioContext, mediaDevices } = webAudio;

    let audio: true | { deviceId: string } = true;
    if (deviceName) {
      const inputs = (await mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      const match = inputs.find((d) => d.label.toLowerCase().includes(deviceName.toLowerCase()));
      if (!match) {
        throw new Error(
          `no input device matching "${deviceName}". Available: ${inputs.map((d) => d.label).join("; ")}`,
        );
      }
      audio = { deviceId: match.deviceId };
    }

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const stream = await mediaDevices.getUserMedia({ audio });
    stop = () => {
      ctx.close().catch(() => {});
    };
    if (out.destroyed) return stop();

    const processor = ctx.createScriptProcessor(2048, CHANNELS, CHANNELS);
    const silent = ctx.createGain(); // keeps the graph running without playing the input back
    silent.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);

    processor.onaudioprocess = ({ inputBuffer }) => {
      const left = inputBuffer.getChannelData(0);
      const right = inputBuffer.getChannelData(1);
      const pcm = Buffer.allocUnsafe(left.length * 4);
      for (let i = 0; i < left.length; i++) {
        pcm.writeInt16LE(toS16(left[i]), i * 4);
        pcm.writeInt16LE(toS16(right[i]), i * 4 + 2);
      }
      out.write(pcm);
    };
  })().catch((err) => out.destroy(err));

  return out;
}
