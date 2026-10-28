// Runs controller verification (see ./controller-auth.ts) on a WebRTC
// connection. The host handles nothing a controller sends until the
// controller proves the temporary password; the controller holds back its
// own requests until then, or until it knows the host predates verification.
import { WsMsgTypeEnum } from '@/types/websocket';

import {
  CONTROLLER_AUTH_CHANNEL,
  type ConnectionFingerprints,
  ControllerHandshake,
  type ControllerHello,
  HostHandshake,
  dtlsFingerprints,
  parseHello,
} from './controller-auth';

/** Why the host refused a controller. */
export type ControllerRejection =
  /** It does not speak controller verification. */
  | 'legacy'
  /** The exchange did not finish: timeout, closed channel, new password. */
  | 'aborted'
  /** It failed to prove the password, or the connection changed afterwards. */
  | 'failed'
  /** Too many failed proofs recently; the host is not accepting attempts. */
  | 'limited';
/** What a controller knows about the host it is connected to. */
export type HostAuthState = 'pending' | 'verified' | 'legacy' | 'failed';

const MESSAGE_CHANNEL = 'MessageChannel';

/** Both sides' fingerprints as this side's SDP shows them, if available. */
function connectionFingerprints(
  connection: RTCPeerConnection,
  side: 'host' | 'controller'
): ConnectionFingerprints | undefined {
  try {
    const local = dtlsFingerprints(
      (connection.currentLocalDescription ?? connection.localDescription)?.sdp
    );
    const remote = dtlsFingerprints(
      (connection.currentRemoteDescription ?? connection.remoteDescription)?.sdp
    );
    return side === 'host'
      ? { host: local, controller: remote }
      : { host: remote, controller: local };
  } catch {
    return undefined;
  }
}

const sameFingerprints = (
  a: ConnectionFingerprints | undefined,
  b: ConnectionFingerprints | undefined
) => !!a && !!b && a.host === b.host && a.controller === b.controller;

function parse(data: unknown) {
  if (typeof data !== 'string' || data.length > 4096) return undefined;
  try {
    const value = JSON.parse(data);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Failed proofs across all controllers. Each one is an online password guess,
 * so the host refuses new attempts for a while after too many.
 */
export class GuessLimiter {
  private failures: number[] = [];

  constructor(
    private limit = 10,
    private window = 10 * 60 * 1000,
    private now = () => Date.now()
  ) {}

  get locked() {
    this.prune();
    return this.failures.length >= this.limit;
  }

  fail() {
    this.prune();
    this.failures.push(this.now());
  }

  private prune() {
    const since = this.now() - this.window;
    this.failures = this.failures.filter((time) => time > since);
  }
}

const guesses = new GuessLimiter();
const verifiers = new WeakMap<RTCPeerConnection, ControllerVerifier>();

/** Whether the controller on this connection proved the password. */
export function controllerVerified(
  connection: RTCPeerConnection | null | undefined
) {
  return !!connection && verifiers.get(connection)?.verified === true;
}

export interface ControllerVerifierOptions {
  connection: RTCPeerConnection;
  /** This host's device code. */
  device: string;
  /** The current temporary password. */
  password: () => string;
  onVerified?: () => void;
  onRejected: (reason: ControllerRejection) => void;
  limiter?: GuessLimiter;
  /** From creation until the controller's first DataChannel arrives. */
  transportTimeout?: number;
  /** From the controller's first DataChannel until it is verified. */
  verifyTimeout?: number;
}

/** Starts verifying the controller on a host connection, once. */
export function verifyController(options: ControllerVerifierOptions) {
  return verifiers.get(options.connection) ?? new ControllerVerifier(options);
}

export class ControllerVerifier {
  verified = false;
  private settled = false;
  private transport = false;
  private handshake?: HostHandshake;
  private password = '';
  private fingerprints?: ConnectionFingerprints;
  private auth?: RTCDataChannel;
  private timer: ReturnType<typeof setTimeout>;
  private listeners: [RTCDataChannel, (event: MessageEvent) => void][] = [];
  private limiter: GuessLimiter;

  constructor(private options: ControllerVerifierOptions) {
    this.limiter = options.limiter ?? guesses;
    verifiers.set(options.connection, this);
    options.connection.addEventListener('datachannel', this.channel);
    options.connection.addEventListener('signalingstatechange', this.check);
    this.timer = setTimeout(
      () => this.reject('aborted'),
      options.transportTimeout ?? 60000
    );
  }

  private channel = ({ channel }: RTCDataChannelEvent) => {
    if (this.settled || this.verified) return;
    if (!this.transport) {
      this.transport = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => this.reject('aborted'),
        this.options.verifyTimeout ?? 30000
      );
    }
    const listener = (event: MessageEvent) => this.inspect(channel, event.data);
    channel.addEventListener('message', listener);
    this.listeners.push([channel, listener]);
  };

  private inspect(channel: RTCDataChannel, data: unknown) {
    if (this.settled || this.verified) return;
    const message = channel.label === MESSAGE_CHANNEL ? parse(data) : undefined;
    if (message?.msgType === WsMsgTypeEnum.remoteAuthHello)
      this.begin(message.data);
    // A controller that can verify says hello first and asks for nothing
    // until it is verified. Anything else first comes from an older release.
    // Presence can race with the hello, so it is only ignored.
    else if (
      !this.handshake &&
      message?.msgType !== WsMsgTypeEnum.remoteControllerState
    )
      this.reject('legacy');
  }

  private begin(data: unknown) {
    if (this.handshake) return; // One attempt per connection.
    if (this.limiter.locked) {
      this.reject('limited');
      return;
    }
    let hello: ControllerHello;
    try {
      hello = parseHello(data);
    } catch {
      this.reject('legacy');
      return;
    }
    this.password = this.options.password();
    if (!this.password) {
      this.reject('aborted');
      return;
    }
    this.handshake = new HostHandshake(
      this.password,
      this.options.device,
      hello
    );
    let auth: RTCDataChannel;
    try {
      auth = this.options.connection.createDataChannel(
        CONTROLLER_AUTH_CHANNEL,
        { ordered: true }
      );
    } catch {
      this.reject('aborted');
      return;
    }
    this.auth = auth;
    auth.addEventListener('open', this.start);
    auth.addEventListener('message', this.finish);
    auth.addEventListener('close', this.closed);
  }

  private start = () => {
    if (this.settled || !this.handshake || !this.auth) return;
    this.fingerprints = connectionFingerprints(this.options.connection, 'host');
    if (!this.fingerprints) {
      this.reject('aborted');
      return;
    }
    try {
      this.auth.send(JSON.stringify(this.handshake.start(this.fingerprints)));
    } catch {
      this.reject('aborted');
    }
  };

  private finish = (event: MessageEvent) => {
    if (this.settled || this.verified || !this.handshake) return;
    let confirm: ReturnType<HostHandshake['finish']>;
    try {
      confirm = this.handshake.finish(event.data);
    } catch {
      this.limiter.fail();
      this.reject('failed');
      return;
    }
    // A password changed during the exchange must not admit the controller.
    if (
      this.options.password() !== this.password ||
      !sameFingerprints(
        connectionFingerprints(this.options.connection, 'host'),
        this.fingerprints
      )
    ) {
      this.reject('aborted');
      return;
    }
    try {
      this.auth!.send(JSON.stringify(confirm));
    } catch {
      this.reject('aborted');
      return;
    }
    this.verified = true;
    clearTimeout(this.timer);
    this.unwatch();
    this.options.onVerified?.();
  };

  private closed = () => {
    if (!this.verified) this.reject('aborted');
  };

  // The proof covers the certificates negotiated so far. Renegotiation must
  // not move a verified controller onto another connection.
  private check = () => {
    if (
      this.verified &&
      !sameFingerprints(
        connectionFingerprints(this.options.connection, 'host'),
        this.fingerprints
      )
    )
      this.reject('failed');
  };

  private unwatch() {
    this.listeners.forEach(([channel, listener]) =>
      channel.removeEventListener('message', listener)
    );
    this.listeners = [];
  }

  private reject(reason: ControllerRejection) {
    if (this.settled) return;
    const open = this.options.connection.signalingState !== 'closed';
    this.dispose();
    if (open) this.options.onRejected(reason);
  }

  dispose() {
    this.settled = true;
    this.verified = false;
    clearTimeout(this.timer);
    this.unwatch();
    const { connection } = this.options;
    connection.removeEventListener('datachannel', this.channel);
    connection.removeEventListener('signalingstatechange', this.check);
    if (verifiers.get(connection) === this) verifiers.delete(connection);
    if (this.auth) {
      this.auth.removeEventListener('open', this.start);
      this.auth.removeEventListener('message', this.finish);
      this.auth.removeEventListener('close', this.closed);
      this.auth.close();
    }
  }
}

export interface HostAuthenticationOptions {
  connection: RTCPeerConnection;
  /** The controller's own MessageChannel, which carries the hello. */
  outgoing: RTCDataChannel;
  /** The host's device code the controller connected to. */
  device: string;
  password: string;
  send: (message: {
    msgType: WsMsgTypeEnum;
    requestId: string;
    data: ControllerHello;
  }) => void;
  /** Sends a request that hosts older than verification answer. */
  probe?: () => void;
  onChange: (state: HostAuthState) => void;
  /** How long to wait for a host that never answers the probe. */
  legacyTimeout?: number;
  exchangeTimeout?: number;
}

/**
 * The controller's side: proves the password to the host and checks that the
 * host knows it too. Hosts released before verification never open the
 * verification channel; they are reported as `legacy`.
 */
export class HostAuthentication {
  state: HostAuthState = 'pending';
  private handshake: ControllerHandshake;
  private auth?: RTCDataChannel;
  private greeted = false;
  private responded = false;
  private fingerprints?: ConnectionFingerprints;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private options: HostAuthenticationOptions) {
    this.handshake = new ControllerHandshake(options.password, options.device);
    options.connection.addEventListener('datachannel', this.channel);
    options.connection.addEventListener('signalingstatechange', this.check);
    // The hello must be the first message on this channel.
    if (options.outgoing.readyState === 'open') this.hello();
    else options.outgoing.addEventListener('open', this.hello);
  }

  private hello = () => {
    if (this.disposed || this.greeted) return;
    this.greeted = true;
    this.options.send({
      msgType: WsMsgTypeEnum.remoteAuthHello,
      requestId: '',
      data: this.handshake.hello(),
    });
    this.timer = setTimeout(
      () => this.legacy(),
      this.options.legacyTimeout ?? 6000
    );
    this.options.probe?.();
  };

  /** The host answered a request before verifying this controller. */
  hostAnswered() {
    this.legacy();
  }

  private legacy() {
    if (this.disposed || this.state !== 'pending' || this.auth) return;
    clearTimeout(this.timer);
    this.set('legacy');
  }

  private channel = ({ channel }: RTCDataChannelEvent) => {
    if (channel.label !== CONTROLLER_AUTH_CHANNEL || this.disposed) return;
    // A late channel still upgrades a connection first taken for legacy.
    if (this.auth || this.state === 'failed' || this.state === 'verified') {
      channel.close();
      return;
    }
    this.auth = channel;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.fail(),
      this.options.exchangeTimeout ?? 30000
    );
    channel.addEventListener('message', this.message);
    channel.addEventListener('close', this.closed);
  };

  private message = (event: MessageEvent) => {
    if (this.disposed || this.state === 'failed' || this.state === 'verified')
      return;
    try {
      if (this.responded) {
        this.handshake.confirm(event.data);
        clearTimeout(this.timer);
        this.set('verified');
        this.auth?.close();
        return;
      }
      this.responded = true;
      this.fingerprints = connectionFingerprints(
        this.options.connection,
        'controller'
      );
      if (!this.fingerprints) throw new Error('No DTLS fingerprints');
      this.auth!.send(
        JSON.stringify(this.handshake.respond(event.data, this.fingerprints))
      );
    } catch {
      this.fail();
    }
  };

  private closed = () => {
    if (this.state !== 'verified') this.fail();
  };

  private check = () => {
    if (
      this.state === 'verified' &&
      !sameFingerprints(
        connectionFingerprints(this.options.connection, 'controller'),
        this.fingerprints
      )
    )
      this.fail();
  };

  private fail() {
    if (this.disposed || this.state === 'failed') return;
    clearTimeout(this.timer);
    this.set('failed');
  }

  private set(state: HostAuthState) {
    this.state = state;
    this.options.onChange(state);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    const { connection, outgoing } = this.options;
    connection.removeEventListener('datachannel', this.channel);
    connection.removeEventListener('signalingstatechange', this.check);
    outgoing.removeEventListener('open', this.hello);
    this.auth?.removeEventListener('message', this.message);
    this.auth?.removeEventListener('close', this.closed);
  }
}
