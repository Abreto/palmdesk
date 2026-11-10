// Proves to the host that a controller knows the temporary password, bound to
// the WebRTC connection the proof arrives on: a signaling server that admits
// or intercepts connections cannot authorize one without the password.
//
// Version 1, after the controller's MessageChannel opens:
//   controller -> host  MessageChannel  remoteAuthHello { versions, nonce }
//   host -> controller  PalmDeskAuth    { type: 'start', version, nonce, share }
//   controller -> host  PalmDeskAuth    { type: 'response', share, confirm }
//   host -> controller  PalmDeskAuth    { type: 'confirm', confirm }
//
// The shares and tags are CPace (draft-irtf-cfrg-cpace-21, cipher suite
// CPACE-RISTR255-SHA512) with the host as initiator and the key confirmation
// of its section 10.4. The session id joins both nonces. The channel
// identifier holds the host's device code and the DTLS fingerprints of both
// sides as each side sees them in its SDP: a server that substitutes its own
// certificates to read the connection makes the two sides derive different
// generators, so the confirmations fail. An attempt tests one password guess
// online; a recorded or intercepted exchange does not allow an offline search.
import {
  ristretto255,
  ristretto255_hasher as ristrettoHasher,
} from '@noble/curves/ed25519.js';
import { bytesToNumberLE } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';

const CONTROLLER_AUTH_VERSION = 1;
/** The DataChannel the host opens after a controller says hello. */
export const CONTROLLER_AUTH_CHANNEL = 'PalmDeskAuth';

export interface ControllerHello {
  versions: number[];
  nonce: string;
}
/** DTLS fingerprints of each side, from the SDP of the party computing. */
export interface ConnectionFingerprints {
  host: string;
  controller: string;
}

const DSI = utf8ToBytes('CPaceRistretto255');
const PROTOCOL = utf8ToBytes('PalmDesk controller verification');
const HOST_AD = utf8ToBytes('PalmDesk host');
const CONTROLLER_AD = utf8ToBytes('PalmDesk controller');
const NONCE_BYTES = 16;
const POINT_BYTES = 32;
const TAG_BYTES = 64;
const MAX_FRAME = 1024;

/** LEB128 length followed by the data (CPace prepend_len). */
export function prependLen(data: Uint8Array) {
  const length: number[] = [];
  let value = data.length;
  do {
    length.push((value & 0x7f) | (value > 0x7f ? 0x80 : 0));
    value >>>= 7;
  } while (value);
  return concatBytes(Uint8Array.from(length), data);
}

export const lvCat = (...parts: Uint8Array[]) =>
  concatBytes(...parts.map(prependLen));

/** CPace generator_string with the SHA-512 block size. */
export function generatorString(
  prs: Uint8Array,
  ci: Uint8Array,
  sid: Uint8Array
) {
  const padding = Math.max(
    0,
    128 - 1 - prependLen(prs).length - prependLen(DSI).length
  );
  return lvCat(DSI, prs, new Uint8Array(padding), ci, sid);
}

export function calculateGenerator(
  prs: Uint8Array,
  ci: Uint8Array,
  sid: Uint8Array
) {
  // RFC 9496 element derivation from 64 uniform bytes.
  return ristrettoHasher.deriveToCurve!(sha512(generatorString(prs, ci, sid)));
}

/** A uniformly random 252-bit scalar, below the group order and nonzero. */
function sampleScalar() {
  for (;;) {
    const bytes = randomBytes(32);
    bytes[31] &= 0x0f;
    const scalar = bytesToNumberLE(bytes);
    if (scalar) return scalar;
  }
}

/** CPace scalar_mult_vfy that aborts instead of returning the identity. */
export function scalarMultVfy(scalar: bigint, encoded: Uint8Array) {
  // Decoding rejects every non-canonical or invalid encoding.
  const point = ristretto255.Point.fromBytes(encoded);
  const result = point.multiply(scalar);
  if (point.is0() || result.is0()) throw new Error('Invalid public share');
  return result.toBytes();
}

/** CPace ISK for the initiator-responder setting. */
export function intermediateKey(
  sid: Uint8Array,
  k: Uint8Array,
  ya: Uint8Array,
  ada: Uint8Array,
  yb: Uint8Array,
  adb: Uint8Array
) {
  return sha512(
    concatBytes(
      lvCat(concatBytes(DSI, utf8ToBytes('_ISK')), sid, k),
      lvCat(ya, ada),
      lvCat(yb, adb)
    )
  );
}

/** Key confirmation tag over one party's own message (CPace section 10.4). */
function confirmation(
  sid: Uint8Array,
  isk: Uint8Array,
  share: Uint8Array,
  ad: Uint8Array
) {
  const key = sha512(concatBytes(utf8ToBytes('CPaceMac'), sid, isk));
  return hmac(sha512, key, lvCat(share, ad));
}

/** Compares secrets without stopping at the first different byte. */
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a[index] ^ b[index];
  return difference === 0;
}

/**
 * The DTLS certificate fingerprints a session description announces, in a
 * canonical form so both sides render the same SDP alike.
 */
export function dtlsFingerprints(sdp: string | undefined) {
  const found = new Set<string>();
  (sdp || '').split('\n').forEach((line) => {
    const match =
      /^a=fingerprint:(\S+)\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})+)$/.exec(
        line.trim()
      );
    if (match) found.add(`${match[1].toLowerCase()} ${match[2].toUpperCase()}`);
  });
  if (!found.size) throw new Error('The connection has no DTLS fingerprint');
  return [...found].sort().join(',');
}

const passwordBytes = (password: string) =>
  utf8ToBytes(password.normalize('NFC'));

// The host is the initiator, so its identity comes first.
const channelIdentifier = (
  offered: number[],
  device: string,
  fingerprints: ConnectionFingerprints
) =>
  lvCat(
    PROTOCOL,
    utf8ToBytes(offered.join(',')),
    utf8ToBytes(String(CONTROLLER_AUTH_VERSION)),
    utf8ToBytes(device),
    utf8ToBytes(fingerprints.host),
    utf8ToBytes(fingerprints.controller)
  );

function hex(value: unknown, bytes: number) {
  if (
    typeof value !== 'string' ||
    value.length !== bytes * 2 ||
    !/^[0-9a-f]+$/.test(value)
  )
    throw new Error('Malformed verification message');
  return hexToBytes(value);
}

function frame(data: unknown, type: string): Record<string, unknown> {
  if (typeof data !== 'string' || data.length > MAX_FRAME)
    throw new Error('Malformed verification message');
  const value = JSON.parse(data);
  if (!value || typeof value !== 'object' || value.type !== type)
    throw new Error('Unexpected verification message');
  return value;
}

/** Accepts a hello that offers this version; throws otherwise. */
export function parseHello(data: unknown): ControllerHello {
  const value = data as Partial<ControllerHello> | null;
  if (
    !value ||
    !Array.isArray(value.versions) ||
    !value.versions.length ||
    value.versions.length > 8 ||
    !value.versions.every((item) => Number.isInteger(item) && item > 0) ||
    !value.versions.includes(CONTROLLER_AUTH_VERSION)
  )
    throw new Error('Unsupported controller verification');
  hex(value.nonce, NONCE_BYTES);
  return { versions: value.versions, nonce: value.nonce as string };
}

/** The host's side: one instance per attempt. */
export class HostHandshake {
  private scalar = sampleScalar();
  private share?: Uint8Array;
  private sid?: Uint8Array;
  private finished = false;

  constructor(
    private password: string,
    private device: string,
    private hello: ControllerHello
  ) {}

  start(fingerprints: ConnectionFingerprints) {
    if (this.share) throw new Error('Verification already started');
    const nonce = randomBytes(NONCE_BYTES);
    this.sid = concatBytes(hexToBytes(this.hello.nonce), nonce);
    const generator = calculateGenerator(
      passwordBytes(this.password),
      channelIdentifier(this.hello.versions, this.device, fingerprints),
      this.sid
    );
    this.share = generator.multiply(this.scalar).toBytes();
    return {
      type: 'start',
      version: CONTROLLER_AUTH_VERSION,
      nonce: bytesToHex(nonce),
      share: bytesToHex(this.share),
    };
  }

  /**
   * Checks the controller's only response and returns the host's
   * confirmation. Throws unless the controller knows the password.
   */
  finish(data: unknown) {
    if (!this.share || !this.sid || this.finished)
      throw new Error('Unexpected verification message');
    this.finished = true;
    const message = frame(data, 'response');
    const share = hex(message.share, POINT_BYTES);
    const tag = hex(message.confirm, TAG_BYTES);
    if (equalBytes(share, this.share)) throw new Error('Reflected share');
    const isk = intermediateKey(
      this.sid,
      scalarMultVfy(this.scalar, share),
      this.share,
      HOST_AD,
      share,
      CONTROLLER_AD
    );
    if (!equalBytes(tag, confirmation(this.sid, isk, share, CONTROLLER_AD)))
      throw new Error('The controller did not prove the password');
    return {
      type: 'confirm',
      confirm: bytesToHex(confirmation(this.sid, isk, this.share, HOST_AD)),
    };
  }
}

/** The controller's side: one instance per connection. */
export class ControllerHandshake {
  private nonce = randomBytes(NONCE_BYTES);
  private versions = [CONTROLLER_AUTH_VERSION];
  private expected?: Uint8Array;
  private responded = false;
  private confirmed = false;

  constructor(
    private password: string,
    private device: string
  ) {}

  hello(): ControllerHello {
    return { versions: this.versions, nonce: bytesToHex(this.nonce) };
  }

  respond(data: unknown, fingerprints: ConnectionFingerprints) {
    if (this.responded) throw new Error('Unexpected verification message');
    this.responded = true;
    const message = frame(data, 'start');
    if (message.version !== CONTROLLER_AUTH_VERSION)
      throw new Error('Unsupported controller verification');
    const hostShare = hex(message.share, POINT_BYTES);
    const sid = concatBytes(this.nonce, hex(message.nonce, NONCE_BYTES));
    const scalar = sampleScalar();
    const share = calculateGenerator(
      passwordBytes(this.password),
      channelIdentifier(this.versions, this.device, fingerprints),
      sid
    )
      .multiply(scalar)
      .toBytes();
    const isk = intermediateKey(
      sid,
      scalarMultVfy(scalar, hostShare),
      hostShare,
      HOST_AD,
      share,
      CONTROLLER_AD
    );
    this.expected = confirmation(sid, isk, hostShare, HOST_AD);
    return {
      type: 'response',
      share: bytesToHex(share),
      confirm: bytesToHex(confirmation(sid, isk, share, CONTROLLER_AD)),
    };
  }

  /** Throws unless the host proved the same password over this connection. */
  confirm(data: unknown) {
    if (!this.expected || this.confirmed)
      throw new Error('Unexpected verification message');
    this.confirmed = true;
    const message = frame(data, 'confirm');
    if (!equalBytes(hex(message.confirm, TAG_BYTES), this.expected))
      throw new Error('The computer did not prove the password');
  }
}
