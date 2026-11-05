import blessed from "blessed";
import { confirmQuit } from "./quit.js";

/** Mode picker shown at startup; `onPick` gets the chosen item's index. */
export function showMenu(
  screen: blessed.Widgets.Screen,
  items: string[],
  onPick: (index: number) => void,
) {
  const list = blessed.list({
    parent: screen,
    top: "center",
    left: "center",
    width: 30,
    height: items.length + 2,
    border: "line",
    label: " ChurchSync ",
    keys: true,
    vi: true,
    items,
    style: { selected: { inverse: true } },
  });
  list.key(["q"], () => confirmQuit(screen));
  list.on("select", (_item, index) => {
    list.destroy();
    onPick(index);
  });
  list.focus();
  screen.render();
}
