/**
 * pw-cat node properties. Auto-connect is off so the node shows up unconnected
 * in the PipeWire graph and the user wires it by hand.
 */
export function nodeProps(name: string, description: string, extra: Record<string, string> = {}): string {
  const props: Record<string, string> = {
    "node.name": name,
    "node.description": `"${description}"`,
    "node.autoconnect": "false",
    ...extra,
  };
  return `{ ${Object.entries(props).map(([k, v]) => `${k} = ${v}`).join(" ")} }`;
}
