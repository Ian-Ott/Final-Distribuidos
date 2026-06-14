// E2E smoke: register organizer, create event, emit (sign + verify).
// Simulates a browser using node:crypto webcrypto.
import { webcrypto } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const subtle = webcrypto.subtle;
const ECDSA = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const PBKDF2_ITERS = 250_000;

function b64(bytes) {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
}
function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
}
async function deriveKey(password, salt) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  ingest(setCookieHeader) {
    if (!setCookieHeader) return;
    for (const c of setCookieHeader.split(/, (?=[^ ;]+=)/)) {
      const [pair] = c.split(";");
      const [k, ...rest] = pair.split("=");
      this.cookies.set(k.trim(), rest.join("=").trim());
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function req(jar, method, path, body) {
  const headers = { "content-type": "application/json" };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  jar.ingest(res.headers.get("set-cookie"));
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const jar = new CookieJar();
const email = `org-${Date.now()}@test.local`;
const password = "supersecret";

const keyPair = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);
const spki = await subtle.exportKey("spki", keyPair.publicKey);
const pkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const aes = await deriveKey(password, salt);
const enc = await subtle.encrypt({ name: "AES-GCM", iv }, aes, pkcs8);

const reg = await req(jar, "POST", "/api/auth/register", {
  email,
  password,
  publicKey: b64(spki),
  encryptedPrivateKey: b64(enc),
  kdfSalt: b64(salt),
  kdfIv: b64(iv),
  role: "ORGANIZER",
});
console.log("register:", reg.status, reg.body);
if (reg.status !== 200) process.exit(1);

const me = await req(jar, "GET", "/api/me");
console.log("me:", me.status, me.body);

const create = await req(jar, "POST", "/api/events", {
  name: "Recital de prueba",
  description: "smoke test",
  datetime: new Date(Date.now() + 86_400_000).toISOString(),
  venue: "Estadio Test",
  price: 100,
  ticketCount: 5,
});
console.log("create:", create.status, create.body);
if (create.status !== 200) process.exit(1);
const eventId = create.body.event.id;

const prep = await req(jar, "POST", `/api/events/${eventId}/emit/prepare`);
console.log("prepare:", prep.status, prep.body);
if (prep.status !== 200) process.exit(1);

const sig = await subtle.sign(ECDSA, keyPair.privateKey, new TextEncoder().encode(canonicalize(prep.body.payload)));
const emit = await req(jar, "POST", `/api/events/${eventId}/emit`, {
  payload: prep.body.payload,
  signature: b64(sig),
});
console.log("emit:", emit.status, emit.body);
if (emit.status !== 200) process.exit(1);

const list = await req(jar, "GET", "/api/events");
console.log("public list count:", list.body.events.length);

const tampered = { ...prep.body.payload, ticketCount: 999 };
const badEmit = await req(jar, "POST", `/api/events/${eventId}/emit`, {
  payload: tampered,
  signature: b64(sig),
});
console.log("tampered emit (expected 4xx):", badEmit.status, badEmit.body);

console.log("\nOK: full register → create → emit flow works against live server");
