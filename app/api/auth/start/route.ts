import { beginOAuth } from "@/lib/google";
import { failure } from "@/lib/http";
export const runtime="nodejs";
export async function GET(request:Request){try{return beginOAuth(request);}catch(error){return failure(error);}}
