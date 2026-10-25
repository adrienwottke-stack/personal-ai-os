import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { failure, respond } from "@/lib/http";
import { getState } from "@/lib/state";
import { config } from "@/lib/config";
import { seedDemo } from "@/lib/demo";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const globalSeed=globalThis as typeof globalThis & {aiOsSeed?:Promise<void>};
export async function GET(request:Request){try{const owner=requireOwner(request);const client=await db();if(config().demo){globalSeed.aiOsSeed ||= seedDemo(client);await globalSeed.aiOsSeed;}return respond(await getState(client,owner));}catch(error){return failure(error);}}
