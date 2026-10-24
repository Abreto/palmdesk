// Saves every format on the system clipboard before a smoke test writes to
// it, and puts them back afterwards with Electron's MIME-based clipboard API.
async function saveClipboard(clipboard) {
  const items = await clipboard.read();
  return Promise.all(
    items.map(async (item) =>
      Object.fromEntries(
        await Promise.all(
          item.types.map(async (type) => [type, await item.getType(type)])
        )
      )
    )
  );
}

function restoreClipboard(clipboard, ClipboardItem, saved) {
  if (!saved.length) {
    clipboard.clear();
    return Promise.resolve();
  }
  return clipboard.write(saved.map((data) => new ClipboardItem(data)));
}

module.exports = { restoreClipboard, saveClipboard };
