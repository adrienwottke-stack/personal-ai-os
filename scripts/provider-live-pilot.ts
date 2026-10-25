import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../lib/db';
import { config } from '../lib/config';
import { enqueue, workOnce } from '../lib/jobs';

if (!process.argv.includes('--confirmed-subscription-check') || process.env.APP_MODE !== 'live') {
  throw new Error('The bounded subscription pilot requires an explicitly selected live installation.');
}
if (!config().aiEnabled) throw new Error('Enable AI only for this bounded pilot invocation.');

const client = await db();
try {
  const availableModelCheck = process.argv.includes('--available-model-check');
  const model = availableModelCheck ? 'gpt-6-luna' : config().model;
  const dedupe = `live-setup:public-research:2026-10-11${availableModelCheck ? ':gpt-6-luna' : ''}`;
  const previous = await client.job.findUnique({ where: { dedupeKey: dedupe } });
  if (!previous) {
    const state = await client.runtimeState.findUniqueOrThrow({ where: { id: 'singleton' } });
    if (state.activeJobId || state.pausedReason || await client.job.count({ where: { status: 'queued' } })) {
      throw new Error('The pilot requires an idle queue without a pause or other pending jobs.');
    }
    await enqueue(client, 'research', {
      focus: 'Am 11. Oktober 2026 aktuell öffentlich ausgeschriebene kleine n8n-, TypeScript- oder API-Automatisierungsprojekte in Deutschland oder remote. Höchstens ein Treffer, nachgelesene Originalquelle. Fehlende oder nur zugangspflichtige Ausschreibungen offen nennen. Keine persönlichen Erfahrungsbehauptungen.',
      maxResults: 1,
    }, config().owner, { dedupe, model });
    await workOnce(client);
  }
  const job = await client.job.findUniqueOrThrow({ where: { dedupeKey: dedupe } });
  const state = await client.runtimeState.findUniqueOrThrow({ where: { id: 'singleton' } });
  const proof = {
    checkedAt: new Date().toISOString(),
    installation: 'personal-ai-os-live',
    jobId: job.id,
    model: job.model,
    reasoning: job.reasoning,
    promptVersion: job.promptVersion,
    schemaVersion: job.schemaVersion,
    status: job.status,
    errorCode: job.errorCode,
    durationMs: job.durationMs,
    usage: job.usage,
    result: job.result,
    callsToday: state.quotaCount,
    pausedReason: state.pausedReason,
    limits: 'One bounded subscription call. Public results remain unreviewed proposals. This does not confirm a personal profile, create an application, or send mail. Tool events are not retained by this runner, so the result alone is not proof of actual web-search use.',
  };
  await writeFile(path.join(config().dataDir, availableModelCheck ? 'live-provider-available-model-pilot.json' : 'live-provider-pilot.json'), JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: job.status, errorCode: job.errorCode, durationMs: job.durationMs, callsToday: state.quotaCount }));
  if (job.status !== 'completed') process.exitCode = 1;
} finally {
  await client.$disconnect();
}
