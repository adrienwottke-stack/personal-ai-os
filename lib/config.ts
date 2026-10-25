import path from "node:path";

export const config = () => ({
  demo: process.env.APP_MODE === "demo",
  appUrl: process.env.APP_URL || "http://127.0.0.1:3141",
  owner: (process.env.OWNER_EMAIL || "").toLowerCase().trim(),
  dataDir: path.resolve(process.env.DATA_DIR || ".data"),
  aiEnabled: process.env.AI_ENABLED === "true",
  mailEnabled: process.env.MAIL_ENABLED === "true" && process.env.APP_MODE !== "demo",
  model: process.env.AI_MODEL || "gpt-6.1-sol",
  reasoning: process.env.AI_REASONING || "medium",
  dailyLimit: Math.min(25, Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 25)),
  timeout: Math.min(300_000, Math.max(10_000, Number(process.env.AI_TIMEOUT_MS) || 300_000)),
  scheduler: process.env.SCHEDULER_ENABLED === "true",
  googleTestMode: process.env.GOOGLE_TEST_MODE !== "false",
});

export const stages = ["new", "reviewed", "prepared", "submitted", "conversation", "offer", "won", "completed", "lost"] as const;
export const stageLabels: Record<string, string> = {
  new: "Neu", reviewed: "Geprüft", prepared: "Vorbereitet", submitted: "Eingereicht",
  conversation: "Im Gespräch", offer: "Angebot", won: "Beauftragt", completed: "Abgeschlossen", lost: "Abgelehnt",
};
export const learningLabels: Record<string, string> = {
  seen: "Kennengelernt", assisted: "Mit Hilfe umgesetzt", independent: "Selbstständig gelöst", transfer: "Übertragen",
};
