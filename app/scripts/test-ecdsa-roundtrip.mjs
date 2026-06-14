// Quick ECDSA P-256 roundtrip: simulate browser WebCrypto signing, verify with node:crypto webcrypto.
// Run: node scripts/test-ecdsa-roundtrip.mjs
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const ECDSA = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

const enc = new TextEncoder();

const kp = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);

const payload = {
  type: "mint_batch",
  eventId: "evt_test_001",
  organizerPublicKey: "fakepubkey",
  ticketCount: 10,
  issuedAt: new Date().toISOString(),
};
const msg = enc.encode(canonicalize(payload));

// Sign with "client" key (raw IEEE P1363 format, the WebCrypto default).
const sig = await subtle.sign(ECDSA, kp.privateKey, msg);

// Export pub key to SPKI (what we'd send to the server).
const spki = await subtle.exportKey("spki", kp.publicKey);

// Re-import on the "server" side from raw SPKI bytes.
const serverPub = await subtle.importKey("spki", spki, ECDSA, false, ["verify"]);

// Verify.
const ok = await subtle.verify(ECDSA, serverPub, sig, msg);

if (!ok) {
  console.error("FAIL: verification failed");
  process.exit(1);
}

// Negative case: tamper payload.
const tampered = enc.encode(canonicalize({ ...payload, ticketCount: 11 }));
const tamperedOk = await subtle.verify(ECDSA, serverPub, sig, tampered);
if (tamperedOk) {
  console.error("FAIL: tampered payload should not verify");
  process.exit(1);
}

console.log("OK: ECDSA P-256 roundtrip + tamper detection passed");
console.log("    signature bytes:", sig.byteLength, "(IEEE P1363 / raw, expected 64)");
