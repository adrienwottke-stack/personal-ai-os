import { requireOwner } from '@/lib/auth';
import { db } from '@/lib/db';
import { chatWithAssistant } from '@/lib/assistant-chat';
import { failure,readJson,respond } from '@/lib/http';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
export async function POST(request:Request){try{const owner=requireOwner(request,true);return respond(await chatWithAssistant(await db(),await readJson(request),owner));}catch(error){return failure(error);}}
