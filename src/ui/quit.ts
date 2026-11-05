import blessed from "blessed";

let open = false;

/** Two-step quit: opens a prompt, and only typing "yes" then Enter exits. Esc cancels. */
export function confirmQuit(screen: blessed.Widgets.Screen) {
  if (open) return;
  open = true;
  const previous = screen.focused;

  const box = blessed.textbox({
    parent: screen,
    top: "center",
    left: "center",
    width: 30,
    height: 3,
    border: "line",
    label: " Type yes to quit ",
    inputOnFocus: true,
    keys: true,
  });

  const close = () => {
    open = false;
    box.destroy();
    previous?.focus();
    screen.render();
  };

  box.on("submit", (value: string) => {
    if (value.trim().toLowerCase() === "yes") {
      screen.destroy();
      process.exit(0);
    }
    close();
  });
  box.on("cancel", close);

  // focus on the next tick so the key that opened this isn't typed into the box
  setImmediate(() => {
    box.focus();
    screen.render();
  });
}
