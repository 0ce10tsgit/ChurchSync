import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { CHANNELS, SAMPLE_RATE } from "./format.js";
import { nodeProps } from "./pipewire.js";

/** Stdin of a pw-cat playback stream: write raw s16le 48 kHz stereo PCM to play it. */
export function openPlayback(): Writable {
  if (process.platform !== "linux") {
    throw new Error("audio playback needs PipeWire on Linux");
  }
  const proc = spawn(
    "pw-cat",
    [
      "--playback",
      "--raw",
      "--format", "s16",
      "--rate", String(SAMPLE_RATE),
      "--channels", String(CHANNELS),
      "-P", nodeProps("ChurchSync-Receive", "ChurchSync Receive"),
      "-",
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  proc.on("error", (err) =>
    proc.stdin.destroy(
      (err as NodeJS.ErrnoException).code === "ENOENT"
        ? new Error("pw-cat not found (install pipewire-utils)")
        : err,
    ),
  );
  // a dying pw-cat closes the pipe; that surfaces as 'error' on stdin, not a crash
  proc.stdin.on("error", () => {});
  proc.stdin.on("close", () => proc.kill());
  return proc.stdin;
}
