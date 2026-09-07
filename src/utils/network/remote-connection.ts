import { WsMsgTypeEnum } from '@/types/websocket';

import { removeRemoteSession, type RemoteSession } from './remote-session';

import type { WebRTCClass } from './webRTC';

type Send = (event: WsMsgTypeEnum, data: Record<string, unknown>) => void;
export const DIRECT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class RemoteConnection {
  private queue = Promise.resolve();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private offerPending = false;
  private restartPending = false;
  private attempts = 0;
  private closed = false;
  private warned = false;
  private expiresAt = 0;

  constructor(
    private rtc: WebRTCClass,
    readonly session: RemoteSession,
    private send: Send,
    private report: (message: string) => void,
    private manualServers: RTCIceServer[]
  ) {
    this.expiresAt = session.config?.expiresAt || 0;
    this.scheduleRefresh(session.config?.refreshAfter);
    rtc.peerConnection!.addEventListener('signalingstatechange', this.onStable);
    window.addEventListener?.('online', this.onOnline);
  }

  private onStable = () => {
    if (
      this.offerPending &&
      this.rtc.peerConnection?.signalingState === 'stable'
    )
      void this.offer();
  };

  private onOnline = () => this.recover(true);

  private enqueue(action: () => Promise<void>) {
    const task = this.queue.then(async () => {
      if (!this.closed && !this.rtc.closed) await action();
    });
    this.queue = task.catch(() => {
      if (!this.closed) {
        this.report('远程连接协商失败，正在重试');
        this.recover(true);
      }
    });
    return this.queue;
  }

  private scheduleRefresh(at = Date.now() + 15000) {
    clearTimeout(this.refreshTimer);
    if (this.closed || this.manualServers.length) return;
    this.refreshTimer = setTimeout(
      () => {
        void this.enqueue(async () => {
          const changed = await this.refresh();
          if (changed) this.requestRestart();
        });
      },
      Math.max(1000, at - Date.now())
    );
  }

  private requestRestart() {
    if (this.session.access.offerer) void this.offer(true);
    else this.send(WsMsgTypeEnum.nativeWebRtcRestart, {});
  }

  async refresh() {
    if (this.manualServers.length || this.closed) return false;
    try {
      const config = await this.session.getConfig();
      if (this.closed) return false;
      this.rtc.peerConnection!.setConfiguration({
        iceServers: config.iceServers,
      });
      const changed =
        this.expiresAt !== config.expiresAt &&
        config.iceServers.some((server) => Boolean(server.credential));
      this.expiresAt = config.expiresAt;
      this.scheduleRefresh(config.refreshAfter);
      this.warned = false;
      return changed;
    } catch {
      if (this.closed) return false;
      this.rtc.peerConnection!.setConfiguration({
        iceServers: DIRECT_ICE_SERVERS,
      });
      if (!this.warned) this.report('中继服务暂不可用，正在尝试直连');
      this.warned = true;
      this.scheduleRefresh();
      return false;
    }
  }

  offer(restart = false) {
    if (!this.session.access.offerer || this.closed) return Promise.resolve();
    this.offerPending = true;
    this.restartPending ||= restart;
    return this.enqueue(async () => {
      const pc = this.rtc.peerConnection!;
      if (pc.signalingState !== 'stable' || !this.offerPending) return;
      const iceRestart = this.restartPending;
      this.offerPending = false;
      this.restartPending = false;
      if (iceRestart) await this.refresh();
      if (this.closed) return;
      this.rtc.awaitingRemoteDescription = true;
      await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
      if (!this.closed)
        this.send(WsMsgTypeEnum.nativeWebRtcOffer, {
          sdp: pc.localDescription,
          iceRestart,
        });
    });
  }

  answer(sdp: RTCSessionDescriptionInit, iceRestart = false) {
    this.rtc.awaitingRemoteDescription = true;
    return this.enqueue(async () => {
      if (iceRestart) await this.refresh();
      if (this.closed) return;
      await this.applyDescription(sdp);
      const pc = this.rtc.peerConnection!;
      await pc.setLocalDescription(await pc.createAnswer());
      if (!this.closed)
        this.send(WsMsgTypeEnum.nativeWebRtcAnswer, {
          sdp: pc.localDescription,
        });
    });
  }

  acceptAnswer(sdp: RTCSessionDescriptionInit) {
    this.rtc.awaitingRemoteDescription = true;
    return this.enqueue(() => this.applyDescription(sdp));
  }

  private async applyDescription(sdp: RTCSessionDescriptionInit) {
    const pc = this.rtc.peerConnection!;
    await pc.setRemoteDescription(sdp);
    this.rtc.awaitingRemoteDescription = false;
    await Promise.all(
      this.rtc.pendingCandidates.splice(0).map(async (candidate) => {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* An old ICE generation may still be in flight. */
        }
      })
    );
  }

  connected() {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.attempts = 0;
  }

  private isConnected() {
    const pc = this.rtc.peerConnection;
    return (
      pc &&
      ['connected', 'completed'].includes(pc.iceConnectionState) &&
      !['failed', 'disconnected', 'closed'].includes(pc.connectionState)
    );
  }

  recover(immediate = false) {
    if (this.closed || this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(
      () => {
        this.recoveryTimer = undefined;
        if (this.closed) return;
        if (!immediate && this.isConnected()) return;
        this.attempts += 1;
        if (this.attempts > 3) {
          this.report('远程连接恢复失败，请重新连接');
          this.rtc.close();
          return;
        }
        this.requestRestart();
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = undefined;
          if (!this.isConnected()) this.recover(true);
        }, 15000);
      },
      immediate ? 0 : 5000
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.recoveryTimer);
    this.rtc.peerConnection?.removeEventListener(
      'signalingstatechange',
      this.onStable
    );
    window.removeEventListener?.('online', this.onOnline);
    this.send(WsMsgTypeEnum.billdDeskEndRemote, {});
    removeRemoteSession(
      this.session.access.socketId,
      this.session.access.peerId,
      this.session.access.id
    );
  }
}
