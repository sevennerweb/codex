export const SESSION_COOKIE_NAME = "travel_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  role: AccountRole;
  sessionVersion: number;
  exp: number;
};

export type AccountRole = "admin" | "guest";

export type AccountConfig = {
  id: "admin" | "guest1" | "guest2" | "test";
  username: string;
  role: AccountRole;
};

export type AuthConfig = {
  accounts: AccountConfig[];
  secret: string;
};

export type SessionAccount = AccountConfig & { sessionVersion: number };

const encoder = new TextEncoder();

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function getAuthConfig(): AuthConfig | null {
  const secret = process.env.TRAVEL_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) return null;

  const accounts: AccountConfig[] = [
    { id: "admin", username: "admin", role: "admin" },
    { id: "guest1", username: "guest1", role: "guest" },
    { id: "guest2", username: "guest2", role: "guest" },
    { id: "test", username: "test", role: "guest" },
  ];
  return { accounts, secret };
}

export async function createSessionToken(account: SessionAccount, secret: string) {
  const payload: SessionPayload = {
    sub: account.id,
    role: account.role,
    sessionVersion: account.sessionVersion,
    exp: Math.floor(Date.now() / 1_000) + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await importSigningKey(secret), encoder.encode(encodedPayload));
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined, config: AuthConfig): Promise<SessionAccount | null> {
  if (!token || token.length > 2_048) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  try {
    const isValid = await crypto.subtle.verify(
      "HMAC",
      await importSigningKey(config.secret),
      decodeBase64Url(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!isValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as Partial<SessionPayload>;
    if (
      typeof payload.sub !== "string"
      || (payload.role !== "admin" && payload.role !== "guest")
      || typeof payload.sessionVersion !== "number"
      || !Number.isSafeInteger(payload.sessionVersion)
      || payload.sessionVersion < 1
      || typeof payload.exp !== "number"
      || !Number.isSafeInteger(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1_000)
    ) return null;

    const account = config.accounts.find((candidate) => candidate.id === payload.sub && candidate.role === payload.role);
    return account ? { id: account.id, username: account.username, role: account.role, sessionVersion: payload.sessionVersion } : null;
  } catch {
    return null;
  }
}
