import { fetchRemoteIce, type RemoteIceConfig } from '@/api/turn';

export interface RemoteSessionAccess {
  id: string;
  token: string;
  socketId: string;
  peerId: string;
  offerer: boolean;
}

export class RemoteSession {
  config?: RemoteIceConfig;
  closed = false;
  candidates: RTCIceCandidateInit[] = [];
  private pending?: Promise<RemoteIceConfig>;
  private abort = new AbortController();

  constructor(readonly access: RemoteSessionAccess) {}

  async getConfig() {
    if (this.closed) throw new Error('连接已结束');
    if (this.config && this.config.refreshAfter > Date.now())
      return this.config;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const config = await fetchRemoteIce(
          this.access.token,
          this.abort.signal
        );
        if (this.closed) throw new Error('连接已结束');
        this.config = config;
        return config;
      } catch (error) {
        if (
          !this.closed &&
          this.config &&
          this.config.expiresAt > Date.now() + 10000
        ) {
          return {
            ...this.config,
            refreshAfter: Math.min(
              Date.now() + 15000,
              this.config.expiresAt - 5000
            ),
          };
        }
        throw error;
      } finally {
        this.pending = undefined;
      }
    })();
    return await this.pending;
  }

  close() {
    this.closed = true;
    this.abort.abort();
    this.config = undefined;
    this.candidates = [];
  }
}

const sessions = new Map<string, RemoteSession>();
const key = (socketId: string, peerId: string) => `${socketId}:${peerId}`;

export function registerRemoteSession(access: RemoteSessionAccess) {
  const id = key(access.socketId, access.peerId);
  const previous = sessions.get(id);
  if (previous?.access.id === access.id) return previous;
  previous?.close();
  const session = new RemoteSession(access);
  sessions.set(id, session);
  return session;
}

export const getRemoteSession = (socketId: string, peerId: string) =>
  sessions.get(key(socketId, peerId));

export function removeRemoteSession(
  socketId: string,
  peerId: string,
  sessionId?: string
) {
  const id = key(socketId, peerId);
  const session = sessions.get(id);
  if (!session || (sessionId && session.access.id !== sessionId)) return;
  session.close();
  sessions.delete(id);
}

export function clearRemoteSessions(socketId: string) {
  Array.from(sessions.values()).forEach((session) => {
    if (session.access.socketId === socketId)
      removeRemoteSession(socketId, session.access.peerId);
  });
}
