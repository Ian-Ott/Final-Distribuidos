import { webcrypto } from "node:crypto";
import { ECDSA_PARAMS, b64ToBytes, canonicalize } from "./common";

export async function verifySignature(
  publicKeyB64: string,
  payload: unknown,
  signatureB64: string,
): Promise<boolean> {
  const spki = b64ToBytes(publicKeyB64);
  const key = await webcrypto.subtle.importKey("spki", spki, ECDSA_PARAMS, false, ["verify"]);
  const message = new Uint8Array(new TextEncoder().encode(canonicalize(payload)));
  return webcrypto.subtle.verify(ECDSA_PARAMS, key, b64ToBytes(signatureB64), message);
}

export { canonicalize };
