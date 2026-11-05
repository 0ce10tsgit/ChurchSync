import net from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CHANNELS, FRAME_SAMPLES, SAMPLE_RATE } from "../audio/format.js";
import {
  ControlMessage,
  DEFAULT_DELAY_MS,
  PROTOCOL_VERSION,
  decodeControl,
  encodeControl,
  sanitizeDelay,
} from "./protocol.js";

const HANDSHAKE_TIMEOUT_MS = 5000;
const FAIL_DELAY_MS = 1000;
const PING_INTERVAL_MS = 5000;
const PING_DEADLINE_MS = 15000;
const MAX_LINE_BYTES = 4096;

export interface StreamParams {
  sampleRate: number;
  channels: number;
  frameSamples: number;
}

export interface ReceiverInfo {
  name: string;
  address: string;
  udpPort: number;
}

/** HMAC over both nonces; `role` stops either side's proof being replayed as the other's. */
function proof(key: Buffer, role: "c" | "s", nonce: string, cnonce: string): string {
  return createHmac("sha256", key).update(role).update(nonce).update(cnonce).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

function readMessages(socket: net.Socket, onMessage: (msg: ControlMessage) => void) {
  let buf = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = decodeControl(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg) onMessage(msg);
    }
    if (buf.length > MAX_LINE_BYTES) socket.destroy();
  });
}

/** Socket addresses can come back as ::ffff:1.2.3.4; UDP source checks want plain IPv4. */
function plainAddress(address: string | undefined): string {
  return (address ?? "").replace(/^::ffff:/, "");
}

export interface ReceiverHandle extends ReceiverInfo {
  /** whether the receiver has been told to play; true until the broadcaster says otherwise */
  readonly playing: boolean;
  setPlaying(playing: boolean): void;
  setDelay(delayMs: number): void;
}

export interface ControlServerOptions {
  port: number;
  key: Buffer;
  host?: string;
  onReceiver: (receiver: ReceiverHandle) => void;
  onGone: (receiver: ReceiverHandle) => void;
  /** listen failures, e.g. the port is already in use */
  onError: (err: Error) => void;
}

export interface ControlServer {
  receivers(): ReceiverHandle[];
  /** also the state receivers that join later start in */
  setAllPlaying(playing: boolean): void;
  delayMs(): number;
  /** applies to every receiver, and to ones that join later */
  setDelay(delayMs: number): void;
  close(): void;
}

/** Broadcaster side: authenticates receivers and tells us where to send audio. */
export function startControlServer(opts: ControlServerOptions): ControlServer {
  const receivers = new Set<ReceiverHandle>();
  let groupPlaying = true;
  let groupDelayMs = DEFAULT_DELAY_MS;

  const server = net.createServer((socket) => {
    let state: "hello" | "auth" | "ready" = "hello";
    let hello: Extract<ControlMessage, { type: "hello" }> | undefined;
    let handle: ReceiverHandle | undefined;
    let playing = groupPlaying;
    let nonce = "";
    let lastPong = Date.now();
    let pingTimer: NodeJS.Timeout | undefined;

    const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    const reject = () => setTimeout(() => socket.destroy(), FAIL_DELAY_MS);
    const send = (msg: ControlMessage) => socket.write(encodeControl(msg));

    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      clearInterval(pingTimer);
      if (handle) {
        receivers.delete(handle);
        opts.onGone(handle);
      }
    });

    readMessages(socket, (msg) => {
      if (state === "hello" && msg.type === "hello") {
        const valid =
          msg.version === PROTOCOL_VERSION &&
          /^[0-9a-f]{32}$/.test(msg.cnonce) &&
          Number.isInteger(msg.udpPort) && msg.udpPort > 0 && msg.udpPort < 65536;
        if (!valid) return socket.destroy();
        hello = msg;
        nonce = randomBytes(16).toString("hex");
        state = "auth";
        send({ type: "challenge", nonce });
      } else if (state === "auth" && msg.type === "auth" && hello) {
        if (!sameHex(msg.hmac, proof(opts.key, "c", nonce, hello.cnonce))) return reject();
        clearTimeout(handshakeTimer);
        state = "ready";
        handle = {
          name: String(hello.name).slice(0, 64),
          address: plainAddress(socket.remoteAddress),
          udpPort: hello.udpPort,
          get playing() {
            return playing;
          },
          setPlaying: (value) => {
            playing = value;
            send({ type: "play", playing: value });
          },
          setDelay: (value) => send({ type: "delay", delayMs: value }),
        };
        send({
          type: "welcome",
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          frameSamples: FRAME_SAMPLES,
          playing,
          delayMs: groupDelayMs,
          proof: proof(opts.key, "s", nonce, hello.cnonce),
        });
        pingTimer = setInterval(() => {
          if (Date.now() - lastPong > PING_DEADLINE_MS) return socket.destroy();
          send({ type: "ping", t: Date.now() });
        }, PING_INTERVAL_MS);
        receivers.add(handle);
        opts.onReceiver(handle);
      } else if (state === "ready" && msg.type === "pong") {
        lastPong = Date.now();
      } else if (msg.type === "bye") {
        socket.destroy();
      }
    });
  });
  server.on("error", opts.onError);
  server.listen(opts.port, opts.host);

  return {
    receivers: () => [...receivers],
    setAllPlaying(playing) {
      groupPlaying = playing;
      for (const receiver of receivers) receiver.setPlaying(playing);
    },
    delayMs: () => groupDelayMs,
    setDelay(delayMs) {
      groupDelayMs = sanitizeDelay(delayMs);
      for (const receiver of receivers) receiver.setDelay(groupDelayMs);
    },
    close: () => server.close(),
  };
}

export interface ConnectOptions {
  host: string;
  port: number;
  key: Buffer;
  name: string;
  /** UDP port this receiver is listening on for audio */
  udpPort: number;
  /** called when the broadcaster tells this receiver to start or stop playing */
  onPlaying?: (playing: boolean) => void;
  /** called when the broadcaster changes the playback delay */
  onDelay?: (delayMs: number) => void;
}

export interface Connection {
  params: StreamParams;
  /** initial play state; true unless the broadcaster says otherwise */
  playing: boolean;
  /** initial playback delay in ms */
  delayMs: number;
  socket: net.Socket;
}

/** Receiver side: dials the broadcaster, proves it has the passphrase, and checks the broadcaster does too. */
export function connectToBroadcaster(opts: ConnectOptions): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: opts.host, port: opts.port });
    const cnonce = randomBytes(16).toString("hex");
    let nonce = "";
    let state: "challenge" | "welcome" | "ready" = "challenge";

    const timer = setTimeout(() => socket.destroy(new Error("handshake timed out")), HANDSHAKE_TIMEOUT_MS);
    const send = (msg: ControlMessage) => socket.write(encodeControl(msg));

    socket.on("error", (err) => {
      clearTimeout(timer);
      if (state !== "ready") reject(err);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (state !== "ready") reject(new Error("connection closed during handshake (wrong passphrase?)"));
    });
    socket.on("connect", () =>
      send({ type: "hello", version: PROTOCOL_VERSION, name: opts.name, cnonce, udpPort: opts.udpPort }),
    );

    readMessages(socket, (msg) => {
      if (state === "challenge" && msg.type === "challenge") {
        nonce = msg.nonce;
        state = "welcome";
        send({ type: "auth", hmac: proof(opts.key, "c", nonce, cnonce) });
      } else if (state === "welcome" && msg.type === "welcome") {
        if (!sameHex(msg.proof, proof(opts.key, "s", nonce, cnonce))) {
          return socket.destroy(new Error("broadcaster failed authentication"));
        }
        clearTimeout(timer);
        state = "ready";
        const { sampleRate, channels, frameSamples } = msg;
        resolve({
          params: { sampleRate, channels, frameSamples },
          playing: msg.playing !== false,
          delayMs: sanitizeDelay(msg.delayMs),
          socket,
        });
      } else if (state === "ready" && msg.type === "ping") {
        send({ type: "pong", t: msg.t });
      } else if (state === "ready" && msg.type === "play" && typeof msg.playing === "boolean") {
        opts.onPlaying?.(msg.playing);
      } else if (state === "ready" && msg.type === "delay") {
        opts.onDelay?.(sanitizeDelay(msg.delayMs));
      }
    });
  });
}
