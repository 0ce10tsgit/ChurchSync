import blessed from "blessed";
import { showClient } from "./client/index.js";
import { showReceiver } from "./receiver/index.js";
import { measureClockDrift } from "./shared/clock.js";
import { options } from "./options.js";
import { showMenu } from "./ui/menu.js";
import { createScreen } from "./ui/screen.js";

const WARN_DRIFT_MS = 50;

const screen = createScreen("ChurchSync");

const clockStatus = blessed.text({
  parent: screen,
  bottom: 0,
  left: 1,
  tags: true,
  content: "Clock drift: checking...",
});

if (options.win) {
  blessed.text({
    parent: screen,
    top: 0,
    right: 1,
    content: `[debug: WASAPI capture${options.winDevice ? ` "${options.winDevice}"` : ""}]`,
  });
}

measureClockDrift()
  .then(({ driftMs }) => {
    const rounded = Math.round(driftMs);
    const direction = rounded === 0 ? "" : rounded > 0 ? " (clock ahead)" : " (clock behind)";
    const color = Math.abs(rounded) > WARN_DRIFT_MS ? "yellow" : "green";
    clockStatus.setContent(`Clock drift: {${color}-fg}${rounded > 0 ? "+" : ""}${rounded} ms${direction}{/}`);
  })
  .catch(() => clockStatus.setContent("Clock drift: unavailable (no NTP access)"))
  .finally(() => screen.render());

function menu() {
  showMenu(screen, ["Broadcast", "Receive"], (i) => {
    (i === 0 ? showClient : showReceiver)(screen, menu);
  });
}

menu();
