const args = process.argv.slice(2);

function valueOf(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const winDevice = valueOf("--win-device");
const port = Number(valueOf("--port"));

/** Command-line flags, read once at startup. */
export const options = {
  /** debug: capture through the OS audio API (WASAPI on Windows) instead of PipeWire */
  win: args.includes("--win") || winDevice !== undefined,
  /** debug: input device to capture, matched by part of its name; default input if unset */
  winDevice,
  /** broadcaster listening port, if the default is taken */
  port: Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined,
};
