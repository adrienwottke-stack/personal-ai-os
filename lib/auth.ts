import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "./config";
import { AppError, equal } from "./util";

export const sessionCookie = "ai_os_session";
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new AppError("AUTH_SETUP", "Die Anmeldung muss zuerst eingerichtet werden.", 503);
  return value;
}
export function sign(value: unknown) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function unsign<T>(token: string): T | null {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || !equal(signature, createHmac("sha256", secret()).update(body).digest("base64url"))) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch { return null; }
}
export function cookiesOf(request: Request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map(v => { const [k, ...rest] = v.trim().split("="); return [k, rest.join("=")]; }));
}
export function localDemo(request: Request) {
  if (!config().demo) return false;
  const host = request.headers.get("host")?.split(":")[0];
  const forwarded = request.headers.get("x-forwarded-host");
  return ["localhost", "127.0.0.1"].includes(host || "") && (!forwarded || forwarded === request.headers.get("host"));
}
export function actor(request: Request) {
  if (localDemo(request)) return "demo@local.example";
  const session = unsign<{ email: string; expires: number }>(cookiesOf(request)[sessionCookie] || "");
  if (!session || session.expires < Date.now() || !config().owner || session.email !== config().owner) throw new AppError("UNAUTHORIZED", "Bitte mit dem freigegebenen Google-Konto anmelden.", 401);
  return session.email;
}
export function requireOwner(request: Request, mutation = false) {
  const owner = actor(request);
  if (mutation) {
    const origin = request.headers.get("origin");
    const expected = new URL(config().appUrl).origin;
    if (!origin || origin !== expected) throw new AppError("ORIGIN", "Diese Aktion muss aus deinem Cockpit erfolgen.", 403);
  }
  return owner;
}
export function integrationAuth(request: Request) {
  const configured = process.env.INTEGRATION_TOKEN || "";
  if (configured.length < 32 || !equal(request.headers.get("authorization") || "", `Bearer ${configured}`)) throw new AppError("INTEGRATION_AUTH", "Integrationszugang fehlt.", 401);
}
export function seal(value: unknown) {
  const key = createHmac("sha256", secret()).update("google-token-v1").digest();
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString("base64url")).join(".");
}
export function unseal<T>(value: string): T {
  const key = createHmac("sha256", secret()).update("google-token-v1").digest();
  const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"));
}
export function ensureLive() {
  if (config().demo) throw new AppError("DEMO_ONLY", "Die Demo verwendet Beispieldaten. Diese Aktion steht im eingerichteten privaten Betrieb zur Verfügung.", 409);
}
