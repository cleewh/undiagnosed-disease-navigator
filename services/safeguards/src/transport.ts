// services/safeguards/src/transport.ts
//
// Encrypted-transport enforcement (task 29.1, Requirement 26.6).
//
// Requirement 26.6: when case data is transmitted between service components or
// to external clients, it is transmitted over an encrypted transport channel,
// and IF a client attempts to connect over an unencrypted transport channel,
// THEN the connection is rejected.
//
// This module deterministically classifies a transport channel (by scheme, or
// by an explicit encrypted flag) and rejects any channel that is not encrypted.

import { fail, SafeguardViolationError, type GuardResult } from "./errors.js";

/**
 * The set of transport schemes considered encrypted. Comparison is
 * case-insensitive. Anything not in this set (e.g. `http`, `ws`, `ftp`) is
 * treated as unencrypted and rejected (Req 26.6).
 */
export const ENCRYPTED_SCHEMES: readonly string[] = ["https", "wss", "tls"];

/** A transport channel to be checked before case data is transmitted. */
export interface TransportChannel {
  /** The transport scheme, e.g. "https", "http", "wss", "ws". */
  readonly scheme: string;
  /**
   * Optional explicit encryption flag. When present it is authoritative: a
   * `false` value rejects the channel regardless of scheme, and a `true` value
   * still requires the scheme to be a recognised encrypted scheme.
   */
  readonly encrypted?: boolean;
}

/** `true` iff `scheme` is a recognised encrypted transport scheme (case-insensitive). */
export function isEncryptedScheme(scheme: string): boolean {
  return ENCRYPTED_SCHEMES.includes(scheme.trim().toLowerCase());
}

/**
 * Extract the lower-cased scheme from a URL-like string (the text before the
 * first "://"), or `undefined` when no scheme is present.
 */
export function schemeFromUrl(url: string): string | undefined {
  const separatorIndex = url.indexOf("://");
  if (separatorIndex <= 0) {
    return undefined;
  }
  return url.slice(0, separatorIndex).trim().toLowerCase();
}

/** The transport channel is encrypted and may carry case data. */
export interface TransportAllowed {
  /** The normalised (lower-cased) scheme that cleared the check. */
  readonly scheme: string;
}

/** Result of {@link guardTransport}. */
export type TransportResult = GuardResult<TransportAllowed>;

/**
 * Decide whether case data may be transmitted over the given channel (Req 26.6).
 *
 * The channel is allowed only when it is encrypted: an explicit `encrypted:
 * false` flag always rejects, and otherwise the scheme must be a recognised
 * encrypted scheme. Pure and deterministic; the input is never mutated.
 */
export function guardTransport(channel: TransportChannel): TransportResult {
  const scheme = channel.scheme.trim().toLowerCase();

  if (channel.encrypted === false) {
    return fail(
      "unencrypted_transport",
      `Transport channel "${scheme}" is marked unencrypted; the connection is rejected.`
    );
  }

  if (!isEncryptedScheme(scheme)) {
    return fail(
      "unencrypted_transport",
      `Transport scheme "${scheme}" is not encrypted; the connection is rejected. Encrypted schemes: ${ENCRYPTED_SCHEMES.join(", ")}.`
    );
  }

  return { ok: true, scheme };
}

/**
 * Convenience guard over a URL-like string: rejects any URL whose scheme is
 * missing or unencrypted (Req 26.6).
 */
export function guardTransportUrl(url: string): TransportResult {
  const scheme = schemeFromUrl(url);
  if (scheme === undefined) {
    return fail(
      "unencrypted_transport",
      `URL "${url}" has no transport scheme; the connection is rejected.`
    );
  }
  return guardTransport({ scheme });
}

/** Convenience predicate: `true` iff {@link guardTransport} would allow the channel. */
export function isEncryptedTransport(channel: TransportChannel): boolean {
  return guardTransport(channel).ok;
}

/**
 * Throwing variant of {@link guardTransport}. Returns the channel on success;
 * throws {@link SafeguardViolationError} when the channel is not encrypted.
 */
export function assertEncryptedTransport(channel: TransportChannel): TransportChannel {
  const result = guardTransport(channel);
  if (!result.ok) {
    throw new SafeguardViolationError(result.error.code, result.error.message);
  }
  return channel;
}
