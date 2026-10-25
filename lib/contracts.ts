import { z } from "zod";
import { stages } from "./config";

const text = z.string().trim().min(1).max(40_000);
const short = z.string().trim().min(1).max(500);
const id = z.string().min(1).max(120);
const nullable = z.string().max(3000).nullable();
const quote = z.string().min(1).max(3000);
const webUrl=z.string().url().regex(/^https?:\/\//);
export const claimSchema = z.object({ id, text: short, evidenceIds: z.array(id).max(20) }).strict();
export type Claim = z.infer<typeof claimSchema>;
export const profileInput = z.object({ name: short, claims: z.array(claimSchema).max(50), skills: z.array(short).max(40), availability: z.string().max(300).nullable(), minimumRate: z.string().max(150).nullable(), confirmed: z.literal(true) }).strict();
export const sourceInput = z.object({ externalId: id, kind: z.enum(["manual", "gmail", "research", "public"]), title: short, company: z.string().max(300).nullable(), url: z.string().url().max(2000).nullable(), content: text }).strict();
export const analysisSchema = z.object({
  summary: z.string().max(1800), verdict: z.enum(["passend", "prüfen", "unpassend"]), reason: z.string().max(1800),
  extracted: z.object({ projectType: nullable, presence: nullable, timeCommitment: nullable, deadline: nullable, pay: nullable, applicationChannel: nullable, contactEmail: z.string().email().nullable() }).strict(),
  fieldEvidence:z.array(z.object({field:z.enum(["projectType","presence","timeCommitment","deadline","pay","applicationChannel","contactEmail"]),quote}).strict()).max(20),
  requirements: z.array(z.object({ name: short, quote, assessment: z.enum(["belegt", "teilweise", "fehlt", "offen"]), evidenceIds: z.array(id), question: nullable }).strict()).max(25),
  questions: z.array(z.string().max(500)).max(15),
}).strict();
export type AnalysisResult = z.infer<typeof analysisSchema>;
export const draftSchema = z.object({
  subject: short, body: z.string().min(1).max(12_000), recipient: z.string().email().nullable(),
  assertions: z.array(z.object({ text: z.string().min(1).max(2000), claimIds: z.array(id).min(1) }).strict()).max(20),
  warnings: z.array(z.string().max(700)).max(15),
}).strict();
export const learningSchema = z.object({ candidates: z.array(z.object({ title: short, concept: z.string().max(4000), exercise: z.string().max(3000), transferQuestion: z.string().max(1000), evidenceId: id }).strict()).max(3) }).strict();
export const exerciseSchema = z.object({ title: short, learningId: id.nullable(), question: z.string().max(3000), hints: z.array(z.string().max(1000)).max(4), checklist: z.array(short).max(10), transferQuestion: z.string().max(1500), sources: z.array(z.object({ title: short, url: webUrl }).strict()).max(4) }).strict();
export const contentSchema = z.object({ title: short, summary: z.string().max(2000), problem: z.string().max(2500), implementation: z.string().max(4000), result: z.string().max(2500), limitations: z.string().max(2000), ownContribution: z.string().max(2000), aiSupport: z.string().max(1500), linkedin: z.string().max(5000), learningNote:z.string().max(4000),reel: z.object({ hook: short, script: z.string().max(3000), shots: z.array(short).max(12) }).strict(), evidenceIds: z.array(id).min(1).max(15), sensitiveNotes: z.array(short).max(10) }).strict();
export type ContentResult = z.infer<typeof contentSchema>;
export const researchSchema = z.object({ opportunities: z.array(z.object({ title: short, company: nullable, url:webUrl, excerpt: z.string().min(30).max(10_000), publishedAt: nullable }).strict()).max(10), notes: z.array(short).max(10) }).strict();
export const technicalSchema = z.object({ answer: z.string().max(8000), requirements: z.array(short).max(20), gaps: z.array(short).max(15), citations: z.array(z.object({ documentId: id, line: z.number().int().positive(), quote }).strict()).max(20) }).strict();
export const outputs = { analyze: analysisSchema, draft: draftSchema, learn: learningSchema, exercise: exerciseSchema, content: contentSchema, research: researchSchema, technical: technicalSchema };
export type JobKind = keyof typeof outputs;
export const stageInput = z.object({ stage: z.enum(stages), proof: z.string().max(2000).optional(), submittedAt: z.string().datetime().optional() }).strict();
export const projectInput = z.object({ title: short, problem: text, inputs: z.string().max(4000), outcome: text, acceptance: text, questions: z.string().max(4000), repository: z.string().url().nullable(), opportunityId: id.nullable() }).strict();
export const evidenceInput = z.object({ projectId: id, title: short, content: text, repository: z.string().url().nullable(), commitSha: z.string().regex(/^[a-f0-9]{7,64}$/i).nullable(), checkedScope: text, origin: z.enum(["work_report", "repository", "acceptance", "experiment"]), confirmed: z.boolean() }).strict();
export const sessionInput = z.object({ learningId: id, answer: text, help: z.string().max(3000), hintsUsed:z.array(z.string().max(1000)).max(4).default([]), result: z.enum(["retry", "assisted", "independent", "transfer"]), minutes: z.number().int().min(1).max(180), transfer: z.boolean(), reviewed: z.boolean() }).strict();
export const documentInput = z.object({ title: short, content: text, source: short, projectId: id.nullable(), approved: z.boolean(), state: z.enum(["current", "stale", "unavailable"]) }).strict();
export const draftEditInput = z.object({ recipient: z.string().email().nullable(), subject: short, body: text, attachmentIds: z.array(id).max(8) }).strict();
export const sendInput = z.object({ draftId: id, snapshotHash: z.string().length(64), idempotencyKey: z.string().uuid(), reviewed: z.literal(true) }).strict();
export const publicationInput = z.object({ contentPackageId: id, expectedHash: z.string().length(64), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), snapshot: z.object({ title: short, summary: text, problem: text, implementation: text, result: text, limitations: text, ownContribution: text, aiSupport: text }).strict(), reviewed: z.literal(true), permissionsConfirmed: z.literal(true) }).strict();
