import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer, length: number, options?: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, derivedKey: Buffer) => {
      if (error) reject(error);
      else resolve(derivedKey);
    };
    if (options) scryptCallback(password, salt, length, options, callback);
    else scryptCallback(password, salt, length, callback);
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24);
  const derived = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt2$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length < 8 || expected.length < 32) return false;

  if (algorithm !== "scrypt" && algorithm !== "scrypt2") return false;
  const derived = await deriveKey(password, salt, expected.length, algorithm === "scrypt2" ? SCRYPT_OPTIONS : undefined);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
