import { requireOwner } from "@/lib/auth";
import { failure, readJson, respond } from "@/lib/http";
import { action } from "@/lib/actions";
import { z } from "zod";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){try{const owner=requireOwner(request,true);const parsed=z.object({action:z.string().min(1).max(60),payload:z.unknown()}).strict().parse(await readJson(request));return respond(await action(parsed.action,parsed.payload,owner));}catch(error){return failure(error);}}
