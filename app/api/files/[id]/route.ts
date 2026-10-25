import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "@/lib/auth";
import { failure } from "@/lib/http";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{requireOwner(request);const {id}=await context.params;const record=await (await db()).attachment.findUniqueOrThrow({where:{id}});return new Response(await readFile(path.join(config().dataDir,"attachments",record.storageKey)),{headers:{"content-type":record.mimeType,"content-disposition":`attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`,"cache-control":"no-store"}});}catch(error){return failure(error);}}
