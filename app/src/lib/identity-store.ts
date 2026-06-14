"use client";

let unlockedPrivateKey: CryptoKey | null = null;

export function setUnlockedKey(key: CryptoKey) {
  unlockedPrivateKey = key;
}

export function getUnlockedKey(): CryptoKey | null {
  return unlockedPrivateKey;
}

export function clearUnlockedKey() {
  unlockedPrivateKey = null;
}
