import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "@/lib/auth";
import { readBody, failure, respond } from "@/lib/http";
import { db } from "@/lib/db";
import { AppError, hash } from "@/lib/util";
import { config } from "@/lib/config";
export const runtime="nodejs";
export async function POST(request:Request){try{requireOwner(request,true);const name=decodeURIComponent(request.headers.get("x-file-name")||"").replace(/[\\/\r\n]/g,"_").slice(0,180);const mimeType=request.headers.get("content-type")?.split(";")[0]||"";if(!name||!["application/pdf","text/plain","text/csv","application/json","image/png","image/jpeg","application/zip"].includes(mimeType))throw new AppError("FILE_TYPE","Bitte PDF, Text, CSV, JSON, PNG, JPEG oder ZIP auswählen.");const bytes=await readBody(request,8_000_000);if(!bytes.length)throw new AppError("EMPTY_FILE","Die Datei ist leer.");const storageKey=crypto.randomUUID();await mkdir(path.join(config().dataDir,"attachments"),{recursive:true,mode:0o700});await writeFile(path.join(config().dataDir,"attachments",storageKey),bytes,{mode:0o600});return respond(await (await db()).attachment.create({data:{name,mimeType,size:bytes.length,hash:hash(bytes.toString("base64")),storageKey}}));}catch(error){return failure(error);}}
