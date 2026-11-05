import blessed from "blessed";
import { startSending } from "../audio/send.js";
import { options } from "../options.js";
import { startControlServer } from "../shared/control.js";
import { localAddresses } from "../shared/net.js";
import { DEFAULT_PORT, deriveKey } from "../shared/protocol.js";

const SLIDER_MAX_MS = 1000;
const SLIDER_STEP_MS = 10;
const BAR_WIDTH = 40;
const METER_WIDTH = 30;
const METER_FLOOR_DB = -60;

type Screen = blessed.Widgets.Screen;

export function showClient(screen: Screen, back: () => void) {
  askPassphrase(screen, back, (passphrase) => showBroadcaster(screen, passphrase));
}

function askPassphrase(screen: Screen, back: () => void, onDone: (passphrase: string) => void) {
  const box = blessed.textbox({
    parent: screen,
    top: "center",
    left: "center",
    width: 40,
    height: 3,
    border: "line",
    label: " Passphrase (esc to go back) ",
    censor: true,
    inputOnFocus: true,
    keys: true,
  });
  box.on("submit", (value: string) => {
    if (!value) return box.readInput();
    box.destroy();
    onDone(value);
  });
  box.on("cancel", () => {
    box.destroy();
    back();
  });
  box.focus();
  screen.render();
}

function showBroadcaster(screen: Screen, passphrase: string) {
  const title = blessed.text({ parent: screen, top: 0, left: 1, tags: true });
  const setTitle = (text: string) => {
    title.setContent(text);
    screen.render();
  };
  const addresses = localAddresses();
  const where = addresses.length
    ? addresses.map((a) => `${a.address} (${blessed.escape(a.name)})`).join(", ")
    : "no network address found";
  const port = options.port ?? DEFAULT_PORT;
  setTitle(`Broadcasting on port ${port}  |  receivers connect to: {bold}${where}{/}`);

  const list = blessed.list({
    parent: screen,
    top: 2,
    left: 0,
    width: "100%",
    height: "100%-8",
    border: "line",
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    style: { selected: { inverse: true }, border: { fg: "white" }, focus: { border: { fg: "cyan" } } },
  });

  const delayBox = blessed.box({
    parent: screen,
    bottom: 3,
    left: 0,
    width: "100%",
    height: 3,
    border: "line",
    label: " Delay ",
    keys: true,
    mouse: true,
    style: { border: { fg: "white" }, focus: { border: { fg: "cyan" } } },
  });

  const buttonStyle = { bg: "blue", fg: "white", focus: { bg: "cyan" } };
  const muteButton = blessed.button({
    parent: screen, bottom: 2, left: 1, width: 22, height: 1, mouse: true,
    content: " Mute/unmute selected ", style: buttonStyle,
  });
  const muteAllButton = blessed.button({
    parent: screen, bottom: 2, left: 25, width: 19, height: 1, mouse: true,
    content: " Mute/unmute all ", style: buttonStyle,
  });

  blessed.text({
    parent: screen,
    bottom: 1,
    left: 1,
    content: "Tab: switch focus   m/Enter: mute selected   a: mute all   left/right: delay   Ctrl+C: quit",
  });

  const key = deriveKey(passphrase);
  const server = startControlServer({
    port,
    key,
    onReceiver: () => refresh(),
    onGone: () => refresh(),
    onError: (err) => setTitle(`{red-fg}Cannot listen on port ${port}: ${blessed.escape(err.message)}{/}`),
  });

  // audio goes to every connected receiver, muted or not; they decide whether to play it
  let inputError = "";
  const sender = startSending({
    key,
    targets: () => server.receivers(),
    onError: (err) => (inputError = err.message),
  });

  const meter = blessed.text({ parent: screen, top: 1, left: 1, tags: true });
  const wiringHint =
    process.platform === "linux" && !options.win ? '   wire "ChurchSync Send" in your PipeWire graph' : "";
  let held = 0;
  function drawMeter() {
    const { packets, level } = sender.stats();
    held = Math.max(level, held * 0.8); // fall off gradually so the bar is readable
    if (inputError) {
      meter.setContent(`{red-fg}Input error: ${blessed.escape(inputError)}{/}`);
    } else {
      const db = held > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(held)) : METER_FLOOR_DB;
      const filled = Math.round(((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * METER_WIDTH);
      const bar = "#".repeat(filled) + "-".repeat(METER_WIDTH - filled);
      const reading = db <= METER_FLOOR_DB ? "-inf" : db.toFixed(0);
      meter.setContent(`Input [${bar}] ${reading} dB   ${packets} packets${wiringHint}`);
    }
    screen.render();
  }
  setInterval(drawMeter, 100);

  let selected = 0;
  list.on("select item", (_item, index) => {
    selected = index;
  });

  function refresh() {
    const receivers = server.receivers();
    list.setLabel(` Receivers (${receivers.length}) `);
    list.setItems(
      receivers.length
        ? receivers.map(
            (r) => `${r.playing ? "{green-fg}playing{/}" : "{yellow-fg}muted  {/}"}  ${r.name}  (${r.address})`,
          )
        : ["waiting for receivers..."],
    );
    if (receivers.length) list.select(Math.min(selected, receivers.length - 1));
    screen.render();
  }

  function toggleSelected() {
    const receiver = server.receivers()[selected];
    if (receiver) receiver.setPlaying(!receiver.playing);
    refresh();
  }

  function toggleAll() {
    const receivers = server.receivers();
    if (!receivers.length) return;
    // if anyone is playing, mute everyone; otherwise unmute everyone
    server.setAllPlaying(!receivers.some((r) => r.playing));
    refresh();
  }

  function drawDelay() {
    const ms = server.delayMs();
    const filled = Math.round((Math.min(ms, SLIDER_MAX_MS) / SLIDER_MAX_MS) * BAR_WIDTH);
    delayBox.setContent(`${String(ms).padStart(4)} ms [${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}]`);
    screen.render();
  }

  function adjustDelay(deltaMs: number) {
    const next = Math.min(SLIDER_MAX_MS, Math.max(0, server.delayMs() + deltaMs));
    server.setDelay(next);
    drawDelay();
  }

  list.key(["m", "enter", "space"], toggleSelected);
  list.key(["a"], toggleAll);
  muteButton.on("press", toggleSelected);
  muteAllButton.on("press", toggleAll);

  delayBox.key(["left", "h"], () => adjustDelay(-SLIDER_STEP_MS));
  delayBox.key(["right", "l"], () => adjustDelay(SLIDER_STEP_MS));
  delayBox.on("click", (mouse: { x: number }) => {
    const barStart = (delayBox.aleft as number) + 1 + "0000 ms [".length;
    const fraction = Math.min(1, Math.max(0, (mouse.x - barStart) / BAR_WIDTH));
    const ms = Math.round((fraction * SLIDER_MAX_MS) / SLIDER_STEP_MS) * SLIDER_STEP_MS;
    server.setDelay(ms);
    drawDelay();
  });

  const focusOrder = [list, delayBox];
  screen.key(["tab"], () => {
    const next = focusOrder[(focusOrder.indexOf(screen.focused as never) + 1) % focusOrder.length];
    next.focus();
    screen.render();
  });

  refresh();
  drawDelay();
  list.focus();
  screen.render();
}
