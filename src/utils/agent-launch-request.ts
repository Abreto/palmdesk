// Keep an explicit launch tied to the exact authenticated connection that
// requested it, including while the main process resolves an installed app.
export async function runAgentLaunch(
  id: unknown,
  operationId: string,
  current: () => boolean,
  launch: (id: unknown, operationId: string) => Promise<void>,
  cancel: (operationId: string) => void
) {
  if (!current()) throw new Error('连接已中断，请重新连接');
  const timer = setInterval(() => {
    if (!current()) cancel(operationId);
  }, 100);
  try {
    await launch(id, operationId);
    if (!current()) throw new Error('连接已中断，请重新连接');
  } finally {
    clearInterval(timer);
    cancel(operationId);
  }
}
