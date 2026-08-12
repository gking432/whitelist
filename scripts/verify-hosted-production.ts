type HealthPayload = {
  ok?: boolean;
  checks?: {
    database?: string;
    database_schema?: string;
    configuration?: string;
  };
  configuration_issue_count?: number;
  release?: string | null;
  services?: {
    jobs?: {
      release?: string | null;
      last_success_at?: string | null;
    };
  };
};

type VoiceHealthPayload = {
  ok?: boolean;
  release?: string | null;
};

export {};

function publicUrl(value: string, label: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const isPrivateIpv4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  const isPrivateIpv6 =
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:");
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    isPrivateIpv4 ||
    isPrivateIpv6
  ) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url.origin;
}

async function response(url: string, init?: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Hosted verification timing values must be positive integers.");
  }
  return parsed;
}

const appUrl = publicUrl(
  process.env.HOSTED_APP_URL ?? process.env.APP_URL ?? "",
  "HOSTED_APP_URL",
);
const voiceUrl = publicUrl(
  process.env.HOSTED_VOICE_URL ?? process.env.NORTHSTAR_VOICE_STREAM_URL ?? "",
  "HOSTED_VOICE_URL",
);
const expectedRelease = process.env.EXPECTED_RELEASE_SHA?.trim().toLowerCase();
const timeoutMs = positiveInteger(process.env.HOSTED_VERIFY_TIMEOUT_MS, 1);
const intervalMs = positiveInteger(process.env.HOSTED_VERIFY_INTERVAL_MS, 15_000);

if (expectedRelease && !/^[a-f0-9]{7,64}$/.test(expectedRelease)) {
  throw new Error("EXPECTED_RELEASE_SHA must be a hexadecimal git SHA.");
}

async function verify() {
  const healthResponse = await response(`${appUrl}/api/health`);
  const health = (await healthResponse.json()) as HealthPayload;
  if (!healthResponse.ok || !health.ok) {
    throw new Error(
      `Hosted app health failed (${healthResponse.status}): ${JSON.stringify(health)}`,
    );
  }
  if (
    health.checks?.database !== "ready" ||
    health.checks?.database_schema !== "ready" ||
    health.checks?.configuration !== "ready" ||
    health.configuration_issue_count !== 0
  ) {
    throw new Error(`Hosted app is not production ready: ${JSON.stringify(health)}`);
  }
  if (expectedRelease && !health.release?.startsWith(expectedRelease)) {
    throw new Error(
      `Hosted app release ${health.release ?? "unknown"} does not match ${expectedRelease}.`,
    );
  }
  if (
    expectedRelease &&
    !health.services?.jobs?.release?.startsWith(expectedRelease)
  ) {
    throw new Error(
      `Hosted jobs release ${health.services?.jobs?.release ?? "unknown"} does not match ${expectedRelease}.`,
    );
  }

  for (const [header, expected] of [
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["strict-transport-security", "max-age="],
  ] as const) {
    const actual = healthResponse.headers.get(header) ?? "";
    if (!actual.toLowerCase().includes(expected)) {
      throw new Error(`Hosted app is missing the expected ${header} header.`);
    }
  }

  const loginResponse = await response(`${appUrl}/login`);
  const loginHtml = await loginResponse.text();
  if (!loginResponse.ok || !loginHtml.includes("Sign in")) {
    throw new Error(`Hosted login did not render correctly (${loginResponse.status}).`);
  }

  const unauthorizedJobs = await response(`${appUrl}/api/jobs/run`, {
    method: "POST",
  });
  if (unauthorizedJobs.status !== 401) {
    throw new Error(
      `Hosted jobs endpoint accepted an unauthenticated request (${unauthorizedJobs.status}).`,
    );
  }

  const voiceHealthResponse = await response(`${voiceUrl}/health`);
  const voiceHealth = (await voiceHealthResponse.json()) as VoiceHealthPayload;
  if (!voiceHealthResponse.ok || !voiceHealth.ok) {
    throw new Error(
      `Hosted voice gateway health failed (${voiceHealthResponse.status}).`,
    );
  }
  if (expectedRelease && !voiceHealth.release?.startsWith(expectedRelease)) {
    throw new Error(
      `Hosted voice release ${voiceHealth.release ?? "unknown"} does not match ${expectedRelease}.`,
    );
  }

  return { health, voiceHealth };
}

const startedAt = Date.now();
let result: Awaited<ReturnType<typeof verify>> | null = null;
let lastError: unknown;
do {
  try {
    result = await verify();
    break;
  } catch (error) {
    lastError = error;
    if (Date.now() - startedAt + intervalMs >= timeoutMs) break;
    console.error(
      `Hosted release is not ready yet: ${error instanceof Error ? error.message : String(error)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
} while (!result);

if (!result) throw lastError;

console.log(
  JSON.stringify(
    {
      ok: true,
      app_url: appUrl,
      voice_url: voiceUrl,
      release: result.health.release ?? null,
      voice_release: result.voiceHealth.release ?? null,
      jobs_release: result.health.services?.jobs?.release ?? null,
      jobs_last_success_at:
        result.health.services?.jobs?.last_success_at ?? null,
      database: result.health.checks?.database,
      database_schema: result.health.checks?.database_schema,
      configuration: result.health.checks?.configuration,
      login: "ready",
      jobs_auth: "protected",
      voice: "ready",
    },
    null,
    2,
  ),
);
