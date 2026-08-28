import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAuthConfig, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getUserCredential } from "@/lib/user-store";

const PASSWORD_HASH_PREFIX = "scrypt";
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!password || password.length > 256) return false;
  const [prefix, saltHex, hashHex, extra] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !saltHex || !hashHex || extra) return false;
  if (!/^[0-9a-f]{32}$/iu.test(saltHex) || !/^[0-9a-f]{64}$/iu.test(hashHex)) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await derivePassword(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function getAccountByUsername(username: string) {
  return getAuthConfig()?.accounts.find((account) => account.username === username) ?? null;
}

export async function getAuthenticatedAccountFromToken(token: string | undefined) {
  const authConfig = getAuthConfig();
  if (!authConfig) return null;
  const account = await verifySessionToken(token, authConfig);
  if (!account) return null;
  const credential = getUserCredential(account.id);
  return credential?.sessionVersion === account.sessionVersion ? account : null;
}

export async function getAuthenticatedAccount(request: NextRequest) {
  return getAuthenticatedAccountFromToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function isAuthenticatedRequest(request: NextRequest) {
  return Boolean(await getAuthenticatedAccount(request));
}
