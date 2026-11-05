import dgram from "node:dgram";
import { performance } from "node:perf_hooks";

const NTP_UNIX_OFFSET_S = 2208988800; // seconds between 1900 and 1970
const NTP_PORT = 123;

export interface ClockDrift {
  /** local clock minus true time; positive means this machine's clock is ahead */
  driftMs: number;
  rttMs: number;
}

const nowMs = () => performance.timeOrigin + performance.now();

function writeNtpTime(buf: Buffer, offset: number, ms: number) {
  buf.writeUInt32BE(Math.floor(ms / 1000) + NTP_UNIX_OFFSET_S, offset);
  buf.writeUInt32BE(Math.floor(((ms % 1000) / 1000) * 2 ** 32), offset + 4);
}

function readNtpTime(buf: Buffer, offset: number): number {
  const seconds = buf.readUInt32BE(offset) - NTP_UNIX_OFFSET_S;
  return seconds * 1000 + (buf.readUInt32BE(offset + 4) / 2 ** 32) * 1000;
}

function query(server: string, timeoutMs: number): Promise<ClockDrift> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const request = Buffer.alloc(48);
    request[0] = 0x23; // LI 0, version 4, mode 3 (client)

    const t1 = nowMs();
    writeNtpTime(request, 40, t1);

    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.close();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("NTP timeout"))), timeoutMs);

    socket.on("error", (err) => done(() => reject(err)));
    socket.on("message", (msg) => {
      const t4 = nowMs();
      const valid =
        msg.length >= 48 &&
        (msg[0] & 7) === 4 && // server mode
        msg[1] !== 0 && // stratum 0 is a kiss-of-death reply
        msg.subarray(24, 32).equals(request.subarray(40, 48)); // echoes our transmit time
      if (!valid) return done(() => reject(new Error("bad NTP reply")));

      const t2 = readNtpTime(msg, 32);
      const t3 = readNtpTime(msg, 40);
      const offset = (t2 - t1 + (t3 - t4)) / 2; // true minus local
      done(() => resolve({ driftMs: -offset, rttMs: t4 - t1 - (t3 - t2) }));
    });
    socket.send(request, NTP_PORT, server, (err) => {
      if (err) done(() => reject(err));
    });
  });
}

/** Asks an NTP server a few times and keeps the lowest-latency (most trustworthy) sample. */
export async function measureClockDrift(server = "pool.ntp.org", samples = 3, timeoutMs = 2000): Promise<ClockDrift> {
  const results: ClockDrift[] = [];
  let lastError: unknown;
  for (let i = 0; i < samples; i++) {
    try {
      results.push(await query(server, timeoutMs));
    } catch (err) {
      lastError = err;
    }
  }
  if (results.length === 0) throw lastError;
  return results.reduce((best, r) => (r.rttMs < best.rttMs ? r : best));
}
