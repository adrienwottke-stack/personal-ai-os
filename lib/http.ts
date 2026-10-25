import { z } from "zod";
import { AppError } from "./util";

export async function readBody(request:Request,limit=1_000_000){
  const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks:Uint8Array[]=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new AppError("BODY_LIMIT","Die übermittelten Daten sind zu groß.",413);}chunks.push(value);}
  return Buffer.concat(chunks);
}
export async function readJson(request:Request){try{return JSON.parse((await readBody(request)).toString("utf8"));}catch(error){if(error instanceof AppError)throw error;throw new AppError("JSON","Die Anfrage enthält kein gültiges JSON.");}}
export function respond(value:unknown,status=200){return Response.json(value,{status,headers:{"cache-control":"no-store"}});}
export function failure(error:unknown){
  if(error instanceof AppError)return respond({error:error.code,message:error.message},error.status);
  if(error instanceof z.ZodError)return respond({error:"VALIDATION",message:"Bitte die Angaben prüfen.",fields:error.issues.map(i=>({path:i.path.join("."),message:i.message}))},400);
  if(error && typeof error==="object" && "code" in error && error.code==="P2025")return respond({error:"NOT_FOUND",message:"Der ausgewählte Eintrag ist nicht mehr vorhanden."},404);
  if(error && typeof error==="object" && "code" in error && error.code==="P2002")return respond({error:"CONFLICT",message:"Dieser Eintrag wurde bereits übernommen."},409);
  console.error("AI OS request failed",error instanceof Error?error.constructor.name:"UnknownError");
  return respond({error:"INTERNAL",message:"Die Aktion konnte nicht abgeschlossen werden. Prüfe den Betriebsbereich und versuche es erneut."},500);
}
