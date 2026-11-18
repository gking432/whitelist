import { NextResponse, type NextRequest } from "next/server";
import { connectionsContext } from "@/lib/connections/context";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CrmGatewayError, readCrmGatewayReview, prepareCrmGatewayChange } from "@/lib/crm/gateway-service";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const ctx=await connectionsContext();if(!ctx)return NextResponse.json({error:"Sign in with owner access."},{status:403});
 const admin=createSupabaseAdminClient();if(!admin)return NextResponse.json({error:"Data service unavailable."},{status:503});
 try{return NextResponse.json(await readCrmGatewayReview(admin,ctx.scope,canWriteBusinessWorkspace(ctx.portal.access)&&!ctx.portal.access.isImpersonating,Object.fromEntries(request.nextUrl.searchParams)),{headers:{"Cache-Control":"private, no-store"}});}catch(e){return NextResponse.json({error:e instanceof CrmGatewayError?e.message:"CRM review unavailable."},{status:e instanceof CrmGatewayError?e.status:503});}
}
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Invalid request origin."},{status:403});
 const ctx=await connectionsContext(true);if(!ctx)return NextResponse.json({error:"Sign in with owner access."},{status:403});
 const admin=createSupabaseAdminClient();if(!admin)return NextResponse.json({error:"Data service unavailable."},{status:503});
 const raw=await request.text();if(raw.length>9000)return NextResponse.json({error:"Request too large."},{status:413});
 try{return NextResponse.json({result:await prepareCrmGatewayChange(admin,{...ctx.scope,actorId:ctx.user.id},JSON.parse(raw))},{headers:{"Cache-Control":"no-store"}});}catch(e){return NextResponse.json({error:e instanceof CrmGatewayError?e.message:"CRM decision could not be prepared. Refresh the source review."},{status:e instanceof CrmGatewayError?e.status:400});}
}
