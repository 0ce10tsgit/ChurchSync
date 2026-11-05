import blessed from "blessed";

export function showReceiver(screen: blessed.Widgets.Screen, back: () => void) {
  const box = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "shrink",
    height: "shrink",
    content: "Receiving (esc to go back)",
  });
  box.key(["escape"], () => {
    box.destroy();
    back();
  });
  box.focus();
  screen.render();
}
