"use client";
// Remembers, in THIS browser only, which files were already registered here, so
// the signing page can warn before a salted file is registered twice (a new
// salt makes a new, unrelated record; the chain cannot tell it is the same file).
// Stores only the file's SHA-256, the network, the record hash and the date —
// never the salt or the name. Browser storage can be unavailable or cleared, so
// every access is guarded and the page works without it.
import type { RegisterNetwork } from "./networks";

const KEY = "niara.register.local-registrations.v1";

export type LocalRegistration = { network: RegisterNetwork; recordHash: string; at: string };

function readAll(): Record<string, LocalRegistration[]> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, LocalRegistration[]>) : {};
  } catch {
    return {};
  }
}

export function previousRegistrations(fileSha256: string): LocalRegistration[] {
  return readAll()[fileSha256.toLowerCase()] ?? [];
}

export function rememberRegistration(fileSha256: string, entry: LocalRegistration): void {
  try {
    const all = readAll();
    const key = fileSha256.toLowerCase();
    const list = (all[key] ?? []).filter((e) => !(e.network === entry.network && e.recordHash === entry.recordHash));
    all[key] = [...list, entry];
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the warning is a convenience, not a guarantee.
  }
}
