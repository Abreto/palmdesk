const CONTROLS = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join();

// Full-screen dialogs over the remote window keep key presses to themselves.
// A window listener in the capture phase runs before every other key handler
// on the page, so no key press reaches the remote window while the dialog is
// open, wherever focus is. Key releases still pass, so a key held before the
// dialog opened is released normally. Tab cycles through the dialog, and
// focus returns to it when its focused control is disabled or removed.
export function holdKeyboard(
  dialog: HTMLElement,
  onKeydown: (event: KeyboardEvent) => void
) {
  function contain() {
    const active = document.activeElement;
    if (!active || !dialog.contains(active) || active.matches(':disabled'))
      dialog.focus({ preventScroll: true });
  }
  function cycle(backwards: boolean) {
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(CONTROLS)
    ).filter((element) => element.getClientRects().length);
    if (!controls.length) {
      dialog.focus({ preventScroll: true });
      return;
    }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    let next = index + (backwards ? -1 : 1);
    if (index < 0) next = backwards ? -1 : 0;
    controls[(next + controls.length) % controls.length].focus();
  }
  function capture(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Tab') {
      event.preventDefault();
      cycle(event.shiftKey);
      return;
    }
    // Typing lands in the dialog even if focus had slipped out of it.
    contain();
    onKeydown(event);
  }
  const observer = new MutationObserver(contain);
  observer.observe(dialog, {
    subtree: true,
    childList: true,
    attributeFilter: ['disabled'],
  });
  window.addEventListener('keydown', capture, true);
  dialog.focus({ preventScroll: true });
  return () => {
    observer.disconnect();
    window.removeEventListener('keydown', capture, true);
  };
}
