import crypto from "node:crypto";

/**
 * Hash data for on-chain content references.
 */
export function sha256Hash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Uses crypto.timingSafeEqual internally; pads the shorter buffer so both
 * are the same length (required by the Node.js API).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Buffers of different lengths are never equal. We still run a
    // constant-time comparison (on zero-padded copies) so the function's
    // timing doesn't leak the fact that lengths differ, but the result is
    // always `false` here — without this explicit check, zero-padding
    // would make strings that only differ by trailing NUL bytes (e.g.
    // "abc" vs "abc\0") compare as equal, which is not the intent.
    const padded = Buffer.alloc(Math.max(bufA.length, bufB.length));
    bufA.copy(padded);
    const paddedB = Buffer.alloc(padded.length);
    bufB.copy(paddedB);
    crypto.timingSafeEqual(padded, paddedB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
