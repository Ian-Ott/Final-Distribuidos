export const ECDSA_PARAMS = {
  name: "ECDSA" as const,
  namedCurve: "P-256" as const,
  hash: "SHA-256" as const,
};

export function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  if (typeof btoa !== "undefined") return btoa(bin);
  return Buffer.from(u8).toString("base64");
}

export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin =
    typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return view;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(view);
  return view;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}
