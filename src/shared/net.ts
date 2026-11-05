import os from "node:os";

export interface LocalAddress {
  name: string;
  address: string;
}

/** This machine's LAN IPv4 addresses, one per network interface. */
export function localAddresses(): LocalAddress[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, infos]) =>
    (infos ?? [])
      .filter((i) => i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
      .map((i) => ({ name, address: i.address })),
  );
}
