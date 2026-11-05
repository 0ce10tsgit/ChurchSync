const args = process.argv.slice(2);

function valueOf(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const winDevice = valueOf("--win-device");

/** Debug flags, read from the command line once at startup. */
export const options = {
  /** capture through the OS audio API (WASAPI on Windows) instead of PipeWire */
  win: args.includes("--win") || winDevice !== undefined,
  /** input device to capture, matched by part of its name; default input if unset */
  winDevice,
};
