import blessed from "blessed";
import { confirmQuit } from "./quit.js";

export function createScreen(title: string) {
  const screen = blessed.screen({ smartCSR: true, title });
  screen.key(["C-c"], () => confirmQuit(screen));
  return screen;
}
