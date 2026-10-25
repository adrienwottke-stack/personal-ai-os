import { requireOwner,sessionCookie } from '@/lib/auth';
import { failure } from '@/lib/http';
export async function POST(request:Request){try{requireOwner(request,true);return Response.json({signedOut:true},{headers:{'set-cookie':`${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`}});}catch(error){return failure(error);}}
