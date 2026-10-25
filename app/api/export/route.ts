import { requireOwner, integrationAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { exportNotes } from '@/lib/exports';
import { failure, respond } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{if(request.headers.has('authorization'))integrationAuth(request);else requireOwner(request);return respond(await exportNotes(await db()));}catch(error){return failure(error);}}
