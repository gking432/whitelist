import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { recordPlatformError } = await import("@/lib/monitoring/server");
  await recordPlatformError({
    source: "server",
    error,
    routePath: request.path,
    routeType: context.routeType,
    digest:
      typeof (error as { digest?: unknown }).digest === "string"
        ? (error as { digest: string }).digest
        : null,
    metadata: {
      method: request.method,
      router_kind: context.routerKind,
      route_path: context.routePath,
      render_source: context.renderSource,
    },
  });
};
