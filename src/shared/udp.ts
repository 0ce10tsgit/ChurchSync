import dgram from "node:dgram";
import { AudioPacket, decodeAudio } from "./protocol.js";

/**
 * UDP socket that only delivers valid audio packets from one source IP.
 * `allowedIp` is the broadcaster's address from the TCP connection.
 */
export function listenForAudio(
  port: number,
  allowedIp: string,
  key: Buffer,
  onPacket: (packet: AudioPacket) => void,
  onError: (err: Error) => void,
): dgram.Socket {
  const socket = dgram.createSocket("udp4");
  socket.on("error", onError);
  socket.on("message", (msg, rinfo) => {
    if (rinfo.address !== allowedIp) return;
    const packet = decodeAudio(msg, key);
    if (packet) onPacket(packet);
  });
  socket.bind(port);
  return socket;
}
