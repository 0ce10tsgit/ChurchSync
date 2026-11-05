import os from "node:os";
import blessed from "blessed";
import { AudioReceiver, startReceiving } from "../audio/receive.js";
import { Connection, connectToBroadcaster, plainAddress } from "../shared/control.js";
import { DEFAULT_PORT, deriveKey, encodeControl } from "../shared/protocol.js";

interface ViewState {
  playing: boolean;
  delayMs: number;
  /** most recent audio problem, e.g. playback unavailable */
  error: string;
  audio?: AudioReceiver;
}

type Screen = blessed.Widgets.Screen;

interface FormValues {
  host: string;
  port: string;
  passphrase: string;
}

export function showReceiver(screen: Screen, back: () => void) {
  showForm(screen, back, { host: "", port: String(DEFAULT_PORT), passphrase: "" });
}

function showForm(screen: Screen, back: () => void, initial: FormValues, autoConnect = false) {
  const container = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: 48,
    height: 12,
    border: "line",
    label: " Connect to broadcaster ",
    tags: true,
  });

  const field = (row: number, label: string, value: string, censor = false) => {
    blessed.text({ parent: container, top: row, left: 2, content: label });
    const box = blessed.textbox({
      parent: container,
      top: row,
      left: 14,
      width: 30,
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      censor,
      style: { bg: "blue", fg: "white" },
    });
    box.setValue(value);
    return box;
  };
  const hostBox = field(1, "Address", initial.host);
  const portBox = field(3, "Port", initial.port);
  const passBox = field(5, "Passphrase", initial.passphrase, true);
  // two rows so a long error wraps instead of being cut off
  const status = blessed.text({ parent: container, top: 7, left: 2, width: 42, height: 2, tags: true, content: "" });
  blessed.text({ parent: container, top: 9, left: 2, content: "Enter: next / connect    Esc: back" });

  const fields = [hostBox, portBox, passBox];
  let connecting = false;

  const setStatus = (text: string) => {
    status.setContent(text);
    screen.render();
  };
  const fail = (message: string, focus: blessed.Widgets.TextboxElement) => {
    connecting = false;
    setStatus(`{red-fg}${blessed.escape(message)}{/}`);
    focus.focus();
  };

  function connect() {
    if (connecting) return;
    const values: FormValues = {
      host: hostBox.getValue().trim(),
      port: portBox.getValue().trim(),
      passphrase: passBox.getValue(),
    };
    const port = Number(values.port);
    if (!values.host) return fail("Enter the broadcaster's address", hostBox);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return fail("Port must be 1-65535", portBox);
    if (!values.passphrase) return fail("Enter the passphrase", passBox);

    connecting = true;
    setStatus(`Connecting to ${blessed.escape(values.host)}:${port}...`);

    const state: ViewState = { playing: true, delayMs: 0, error: "" };
    const key = deriveKey(values.passphrase);
    let update = () => {};
    connectToBroadcaster({
      host: values.host,
      port,
      key,
      name: os.hostname(),
      udpPort: DEFAULT_PORT,
      onPlaying: (playing) => {
        state.playing = playing;
        state.audio?.setPlaying(playing);
        update();
      },
      onDelay: (delayMs) => {
        state.delayMs = delayMs;
        state.audio?.setDelay(delayMs);
        update();
      },
    }).then(
      (connection) => {
        state.playing = connection.playing;
        state.delayMs = connection.delayMs;
        state.audio = startReceiving({
          port: DEFAULT_PORT,
          allowedIp: plainAddress(connection.socket.remoteAddress),
          key,
          delayMs: connection.delayMs,
          playing: connection.playing,
          onError: (err) => {
            state.error = err.message;
            update();
          },
        });
        container.destroy();
        showConnected(screen, back, values, port, connection, state, (draw) => (update = draw));
      },
      (err: Error) => fail(err.message, passBox),
    );
  }

  fields.forEach((f, i) => {
    f.on("submit", () => (i < fields.length - 1 ? fields[i + 1].focus() : connect()));
    f.on("cancel", () => {
      container.destroy();
      back();
    });
  });

  screen.render();
  if (autoConnect) connect();
  else hostBox.focus();
}

function showConnected(
  screen: Screen,
  back: () => void,
  values: FormValues,
  port: number,
  connection: Connection,
  state: ViewState,
  setUpdater: (draw: () => void) => void,
) {
  const box = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: 60,
    height: 11,
    border: "line",
    label: " Receiving ",
    tags: true,
    keys: true,
  });

  let connected = true;
  let leaving = false;

  const draw = () => {
    const status = !connected
      ? "{red-fg}disconnected{/}"
      : state.playing
        ? "{green-fg}playing{/}"
        : "{yellow-fg}muted by broadcaster{/}";
    const { sampleRate, channels } = connection.params;
    const s = state.audio?.stats();
    const note = state.error
      ? `{red-fg}${blessed.escape(state.error)}{/}`
      : process.platform === "linux"
        ? 'Wire "ChurchSync Receive" to your speakers in the PipeWire graph'
        : "";
    box.setContent(
      [
        ` Broadcaster  ${blessed.escape(values.host)}:${port}`,
        ` Status       ${status}`,
        ` Delay        ${state.delayMs} ms`,
        ` Stream       ${sampleRate} Hz, ${channels} ch`,
        ` Audio        ${s ? `${s.packets} in, buffered ${s.depth}, lost ${s.lost}, late ${s.late}` : "-"}`,
        "",
        ` ${note}`,
        connected ? " d: disconnect" : " r: reconnect    d: back to form",
      ].join("\n"),
    );
    screen.render();
  };
  setUpdater(draw);
  const refreshTimer = setInterval(draw, 500);

  const stopAudio = () => {
    clearInterval(refreshTimer);
    state.audio?.stop();
  };

  connection.socket.on("close", () => {
    if (leaving) return;
    connected = false;
    stopAudio();
    draw();
  });

  const toForm = (autoConnect: boolean) => {
    leaving = true;
    stopAudio();
    box.destroy();
    showForm(screen, back, values, autoConnect);
  };
  box.key(["d"], () => {
    if (connected) connection.socket.end(encodeControl({ type: "bye" }));
    toForm(false);
  });
  box.key(["r"], () => {
    if (!connected) toForm(true);
  });

  box.focus();
  draw();
}
