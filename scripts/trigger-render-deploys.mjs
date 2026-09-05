const release = process.env.RELEASE_SHA?.trim().toLowerCase();

if (!release || !/^[a-f0-9]{40}$/.test(release)) {
  throw new Error("RELEASE_SHA must be a full 40-character git SHA.");
}

const services = [
  ["app", process.env.RENDER_APP_DEPLOY_HOOK_URL],
  ["jobs", process.env.RENDER_JOBS_DEPLOY_HOOK_URL],
  ["voice", process.env.RENDER_VOICE_DEPLOY_HOOK_URL],
];

for (const [name, value] of services) {
  if (!value) throw new Error(`The ${name} Render deploy hook is missing.`);

  const hook = new URL(value);
  if (hook.protocol !== "https:" || hook.hostname !== "api.render.com") {
    throw new Error(`The ${name} Render deploy hook must use api.render.com over HTTPS.`);
  }
  hook.searchParams.set("ref", release);

  const response = await fetch(hook, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`Render rejected the ${name} deploy (${response.status}).`);
  }

  const payload = await response.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      service: name,
      accepted: true,
      status: response.status,
      deploy_id:
        payload && typeof payload === "object" && "id" in payload
          ? payload.id
          : null,
      release,
    }),
  );
}
