import { db } from "@/lib/db";
import { respond } from "@/lib/http";
import { config } from "@/lib/config";
export const dynamic="force-dynamic";
export async function GET(){try{await (await db()).$queryRaw`SELECT 1`;return respond({ok:true,mode:config().demo?"demo":"live",version:"0.1.0"});}catch{return respond({ok:false,error:"DATABASE_NOT_READY"},503);}}
