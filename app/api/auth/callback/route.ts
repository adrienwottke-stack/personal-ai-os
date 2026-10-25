import { finishOAuth } from "@/lib/google";
import { db } from "@/lib/db";
import { failure } from "@/lib/http";
export const runtime="nodejs";
export async function GET(request:Request){try{return await finishOAuth(await db(),request);}catch(error){return failure(error);}}
