/** Why the host or the service ended a controller's session. */
export type SessionEndReason = 'explicit' | 'password-changed' | 'unverified';

/** Endings a controller must not try to recover from by reconnecting. */
export function isFinalSessionEnd(reason: unknown): reason is SessionEndReason {
  return (
    reason === 'explicit' ||
    reason === 'password-changed' ||
    reason === 'unverified'
  );
}

/** What a controller shows when the host or the service ends its session. */
export function sessionEndMessage(reason?: unknown) {
  if (reason === 'password-changed')
    return '电脑已更新临时密码，请使用新密码重新连接';
  if (reason === 'unverified')
    return '电脑未能验证此连接，请刷新页面或更新 PalmDesk 后重新连接';
  return '电脑已结束本次连接，请手动重新连接';
}

/**
 * Applies a new temporary password, then ends every controller session that
 * existed when the change started: a new password must remove everyone, not
 * only block new connections. Returns how many controllers were disconnected,
 * or `undefined` when the change failed and every session was kept.
 */
export async function changeTemporaryPassword(options: {
  connected: () => string[];
  update: () => Promise<boolean>;
  disconnect: (controller: string, reason: SessionEndReason) => void;
}) {
  // The service may end these sessions before it answers; collect them first.
  const controllers = options.connected();
  if (!(await options.update())) return undefined;
  controllers.forEach((controller) =>
    options.disconnect(controller, 'password-changed')
  );
  return controllers.length;
}
