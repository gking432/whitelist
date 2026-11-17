import { NextResponse } from "next/server";
import { getAuthState } from "@/lib/auth/session";
import { isLocalDevAutoLoginEnabled } from "@/lib/env";
import {
  openMobileTestWorkspace,
  openTestWorkspace,
} from "@/app/workspaces/actions";

// A local-only shortcut into the explicitly seeded test business. Production
// always returns 404; this reuses existing auth and audited impersonation.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || !isLocalDevAutoLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const requestUrl = new URL(request.url);
  const mobile = requestUrl.searchParams.get("view") === "mobile";
  const entryPath = mobile ? "/dev/prototype?view=mobile" : "/dev/prototype";
  const { user } = await getAuthState();
  if (!user || user.email !== "platform@northstar.test") {
    const loginUrl = new URL("/dev/auto-login", requestUrl);
    loginUrl.searchParams.set("next", entryPath);
    return NextResponse.redirect(loginUrl);
  }
  if (mobile) await openMobileTestWorkspace();
  else await openTestWorkspace("client");
  return NextResponse.redirect(
    new URL(mobile ? "/client/mobile" : "/client", requestUrl),
  );
}
