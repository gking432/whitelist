export function summarizeJobResults(
  entries: Array<[string, PromiseSettledResult<unknown>]>,
) {
  const workers: Record<string, unknown> = {};
  let ok = true;
  for (const [name, result] of entries) {
    if (result.status === "rejected") {
      ok = false;
      workers[name] = {
        ok: false,
        error: "Worker failed; inspect the queue and platform logs.",
      };
    } else {
      workers[name] = result.value;
      const value = result.value as { ok?: boolean; failed?: number } | null;
      if (
        value?.ok === false ||
        (typeof value?.failed === "number" && value.failed > 0)
      )
        ok = false;
    }
  }
  return { ok, workers };
}
