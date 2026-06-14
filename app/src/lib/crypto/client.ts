"use client";

import { ECDSA_PARAMS, bytesToB64, b64ToBytes, canonicalize, randomBytes } from "./common";

const PBKDF2_ITERS = 250_000;

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const pwBytes = new Uint8Array(enc.encode(password));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    pwBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface NewIdentity {
  publicKeyB64: string;
  encryptedPrivateKeyB64: string;
  kdfSaltB64: string;
  kdfIvB64: string;
}

export async function generateIdentity(password: string): Promise<NewIdentity> {
  const keyPair = (await crypto.subtle.generateKey(ECDSA_PARAMS, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const publicSpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privatePkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aesKey = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, privatePkcs8);

  return {
    publicKeyB64: bytesToB64(publicSpki),
    encryptedPrivateKeyB64: bytesToB64(encrypted),
    kdfSaltB64: bytesToB64(salt),
    kdfIvB64: bytesToB64(iv),
  };
}

export async function unlockPrivateKey(
  password: string,
  encryptedPrivateKeyB64: string,
  kdfSaltB64: string,
  kdfIvB64: string,
): Promise<CryptoKey> {
  const salt = b64ToBytes(kdfSaltB64);
  const iv = b64ToBytes(kdfIvB64);
  const aesKey = await deriveKey(password, salt);
  const pkcs8 = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    b64ToBytes(encryptedPrivateKeyB64),
  );
  return crypto.subtle.importKey("pkcs8", pkcs8, ECDSA_PARAMS, false, ["sign"]);
}

export async function signPayload(privateKey: CryptoKey, payload: unknown): Promise<string> {
  const message = new Uint8Array(new TextEncoder().encode(canonicalize(payload)));
  const sig = await crypto.subtle.sign(ECDSA_PARAMS, privateKey, message);
  return bytesToB64(sig);
}

export { canonicalize };
