import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([,v]) => v !== undefined).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const object = <T>(value: unknown): T => value as T;
export const token = () => randomBytes(32).toString("base64url");
export function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(date);
}
export function workingDays(from: Date, days: number) {
  const next = new Date(from);
  let remaining = days;
  while (remaining > 0) { next.setUTCDate(next.getUTCDate() + 1); const d = next.getUTCDay(); if (d !== 0 && d !== 6) remaining--; }
  return next;
}
export function canonicalUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new AppError("URL", "Bitte einen öffentlichen http(s)-Link verwenden.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.toString();
}
export const slugify = (title: string) => title.toLowerCase().replace(/[ä]/g, "ae").replace(/[ö]/g, "oe").replace(/[ü]/g, "ue").replace(/[ß]/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 75);
