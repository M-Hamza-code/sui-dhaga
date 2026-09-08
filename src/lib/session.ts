// Session token signing/verification for Sui Dhaga's single-admin auth.
//
// Deliberately dependency-free: uses the Web Crypto API (`crypto.subtle`),
// which is available as a global in both the Node.js runtime (Node 19+)
// and the Next.js Edge runtime (middleware). That lets this module be
// imported from middleware.ts without pulling in Node-only APIs.
//
// Token shape: `${base64url(payload json)}.${base64url(hmac-sha256 signature)}`
// This is intentionally simpler than a full JWT (no header, no algorithm
// negotiation) since there is exactly one issuer, one verifier, and one
// fixed algorithm — a JWT library would be unnecessary surface area here.

export const SESSION_COOKIE = {
  name: "sd_session",
  maxAge: 60 * 60 * 24 * 7, // 7 days, in seconds
};

export interface SessionPayload {
  sub: string; // user id
  email: string;
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
}

function getSecretKeyBytes(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to your .env file (see .env.example)."
    );
  }
  return new TextEncoder().encode(secret);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    getSecretKeyBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSessionToken(
  claims: Pick<SessionPayload, "sub" | "email">
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...claims,
    iat: now,
    exp: now + SESSION_COOKIE.maxAge,
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(body);
  return `${body}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expectedSignature = await hmacSign(body);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    return null;
  }

  if (
    typeof payload.exp !== "number" ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
}
