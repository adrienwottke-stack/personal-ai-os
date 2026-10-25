import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "./config";
import { actor, cookiesOf, ensureLive, seal, sessionCookie, sign, unseal, unsign } from "./auth";
import { AppError, equal, json, token } from "./util";
import { audit } from "./db";

const googleScopes = {
  login: ["openid", "email", "profile"],
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  gmail_alarms: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  calendar: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.readonly"],
};
type Purpose = keyof typeof googleScopes;
type OAuthState = { nonce: string; verifier: string; purpose: Purpose; email: string | null; expires: number };
type Tokens = { access_token: string; refresh_token?: string; expires_at: number; scope: string };
export const oauthReady = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && config().owner && process.env.SESSION_SECRET?.length! >= 32);
const cookieOptions = () => `Path=/; HttpOnly; SameSite=Lax${new URL(config().appUrl).protocol === "https:" ? "; Secure" : ""}`;

export function beginOAuth(request: Request) {
  ensureLive();
  if (!oauthReady()) throw new AppError("GOOGLE_SETUP", "Google-Anmeldung und freigegebenes Konto müssen eingerichtet werden.", 503);
  const value = new URL(request.url).searchParams.get("purpose") || "login";
  if (!Object.hasOwn(googleScopes, value)) throw new AppError("SCOPE", "Unbekannte Verbindung.");
  const purpose = value as Purpose;
  if(purpose==='gmail_alarms'&&!process.env.GMAIL_ALARM_OWNER_EMAIL)throw new AppError('ALARM_MAILBOX','Das Postfach für Projektalarme ist noch nicht festgelegt.',409);
  const email = purpose === "login" ? null : actor(request);
  const nonce = token(); const verifier = token();
  const state = sign({ nonce, verifier, purpose, email, expires: Date.now() + 600_000 } satisfies OAuthState);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const values = { client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: `${config().appUrl}/api/auth/callback`, response_type: "code", scope: googleScopes[purpose].join(" "), state: nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: purpose === "login" ? "online" : "offline", prompt: purpose === "login" ? "select_account" : "consent", login_hint: purpose==='gmail_alarms'?(process.env.GMAIL_ALARM_OWNER_EMAIL||''):config().owner };
  for (const [key, val] of Object.entries(values)) url.searchParams.set(key, val);
  return new Response(null, { status: 302, headers: { location: url.toString(), "set-cookie": `ai_os_oauth=${state}; Max-Age=600; ${cookieOptions()}`, "cache-control": "no-store" } });
}

async function tokenRequest(values: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ ...values, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new AppError("GOOGLE_REAUTHORIZE", "Die Google-Verbindung muss erneut bestätigt werden.", 409);
  return response.json() as Promise<{access_token: string; refresh_token?: string; expires_in: number; scope?: string}>;
}

export async function finishOAuth(client: PrismaClient, request: Request) {
  ensureLive();
  const params = new URL(request.url).searchParams;
  const state = unsign<OAuthState>(cookiesOf(request).ai_os_oauth || "");
  if (!state || state.expires < Date.now() || !equal(params.get("state") || "", state.nonce) || !params.get("code")) throw new AppError("OAUTH_STATE", "Die Anmeldung ist abgelaufen. Bitte neu beginnen.", 403);
  if (state.purpose !== "login" && actor(request) !== state.email) throw new AppError("OAUTH_OWNER", "Die Verbindung muss von deinem angemeldeten Konto bestätigt werden.", 403);
  const received = await tokenRequest({ grant_type: "authorization_code", code: params.get("code")!, code_verifier: state.verifier, redirect_uri: `${config().appUrl}/api/auth/callback` });
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${received.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new AppError("GOOGLE_IDENTITY", "Das Google-Konto konnte nicht bestätigt werden.", 403);
  const user = await response.json() as { email?: string; email_verified?: boolean };
  const expectedEmail=state.purpose==='gmail_alarms'?(process.env.GMAIL_ALARM_OWNER_EMAIL||'').trim().toLowerCase():config().owner;
  if (!user.email_verified || !expectedEmail || user.email?.toLowerCase() !== expectedEmail) throw new AppError("OWNER_ONLY", "Dieses Google-Konto ist für diese Verbindung nicht freigegeben.", 403);
  if (state.purpose !== "login") {
    const scopes = (received.scope || "").split(" ");
    if (googleScopes[state.purpose].some(s => s.startsWith("https:") && !scopes.includes(s))) throw new AppError("GOOGLE_SCOPE", "Die benötigten Berechtigungen wurden nicht vollständig bestätigt.", 403);
    const previous = await client.integration.findUnique({ where: { id: state.purpose } });
    const old = previous?.sealed ? unseal<Tokens>(previous.sealed) : null;
    const stored: Tokens = { access_token: received.access_token, refresh_token: received.refresh_token || old?.refresh_token, expires_at: Date.now() + received.expires_in * 1000, scope: received.scope || "" };
    await client.integration.upsert({ where: { id: state.purpose }, create: { id: state.purpose, status: "connected", sealed: seal(stored), scopes: json(scopes), detail: user.email!, checkedAt: new Date() }, update: { status: "connected", sealed: seal(stored), scopes: json(scopes), detail: user.email!, checkedAt: new Date() } });
    await client.integration.upsert({where:{id:state.purpose+'_consent'},create:{id:state.purpose+'_consent',status:'checked',scopes:[],detail:config().googleTestMode?'Im Testmodus spätestens am '+new Date(Date.now()+7*86400_000).toLocaleDateString('de-DE')+' erneut bestätigen.':'Zustimmung erneuern, wenn Google es verlangt.',checkedAt:new Date()},update:{detail:config().googleTestMode?'Im Testmodus spätestens am '+new Date(Date.now()+7*86400_000).toLocaleDateString('de-DE')+' erneut bestätigen.':'Zustimmung erneuern, wenn Google es verlangt.',checkedAt:new Date()}});
    await audit(client, "google.connected", user.email!, state.purpose, { purpose: state.purpose });
  }
  const headers = new Headers({ location: `${config().appUrl}/?view=settings`, "cache-control": "no-store" });
  headers.append("set-cookie", `${sessionCookie}=${sign({ email: config().owner, expires: Date.now() + 12 * 60 * 60_000 })}; Max-Age=43200; ${cookieOptions()}`);
  headers.append("set-cookie", `ai_os_oauth=; Max-Age=0; ${cookieOptions()}`);
  return new Response(null, { status: 302, headers });
}

export async function googleFetch<T>(client: PrismaClient, purpose: "gmail" | "gmail_alarms" | "calendar", resource: string, options: RequestInit = {}): Promise<T> {
  ensureLive();
  const integration = await client.integration.findUnique({ where: { id: purpose } });
  if (!integration?.sealed || integration.status !== "connected") throw new AppError("GOOGLE_DISCONNECTED", `${purpose.startsWith("gmail") ? "Gmail" : "Kalender"} ist noch nicht verbunden.`, 409);
  let tokens = unseal<Tokens>(integration.sealed);
  if (tokens.expires_at < Date.now() + 60_000) {
    if (!tokens.refresh_token) throw new AppError("GOOGLE_REAUTHORIZE", "Die Google-Verbindung muss erneut bestätigt werden.", 409);
    try {
      const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      tokens = { ...tokens, access_token: refreshed.access_token, expires_at: Date.now() + refreshed.expires_in * 1000 };
      await client.integration.update({ where: { id: purpose }, data: { sealed: seal(tokens), checkedAt: new Date() } });
    } catch (error) { await client.integration.update({ where: { id: purpose }, data: { status: "reauthorize", detail: "Verbindung erneut bestätigen" } }); throw error; }
  }
  const base = purpose.startsWith("gmail") ? "https://gmail.googleapis.com/gmail/v1/users/me/" : "https://www.googleapis.com/calendar/v3/";
  // A fixed provider base prevents an integration URL from receiving OAuth tokens.
  if (resource.startsWith("/") || resource.includes("://")) throw new AppError("GOOGLE_RESOURCE", "Unzulässige Anbieteradresse.");
  const response = await fetch(base + resource, { ...options, headers: { ...options.headers, authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new AppError(response.status === 401 ? "GOOGLE_REAUTHORIZE" : "GOOGLE_REQUEST", "Die Google-Anfrage konnte nicht bestätigt werden.", response.status === 401 ? 409 : 502);
  return response.json() as Promise<T>;
}

export async function calendarEvents(client: PrismaClient) {
  const now = new Date(); const until = new Date(now.getTime() + 7 * 86400_000);
  const query = new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "40" });
  return googleFetch<{items?: {id: string; summary?: string; start: {dateTime?: string; date?: string}; end: {dateTime?: string; date?: string}; htmlLink?: string}[]}>(client, "calendar", `calendars/primary/events?${query}`);
}
