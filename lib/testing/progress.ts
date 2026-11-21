import type { SupabaseClient } from "@supabase/supabase-js";

import type { CapabilityKey } from "../packages/capabilities.ts";

export type FeatureTestProgressRun = {
  capability_key: string;
  status: string;
  completed_at?: string | null;
  created_at: string;
};

export type FeatureTestProgress = {
  total: number;
  passed: number;
  complete: boolean;
  missingKeys: CapabilityKey[];
  failedKeys: CapabilityKey[];
  latestByCapability: Map<CapabilityKey, { status: string; at: string | null }>;
};

export function featureTestProgress(
  capabilityKeys: CapabilityKey[],
  runs: FeatureTestProgressRun[],
): FeatureTestProgress {
  const included = new Set<CapabilityKey>(capabilityKeys);
  const latestByCapability = new Map<
    CapabilityKey,
    { status: string; at: string | null }
  >();

  for (const run of runs) {
    const key = run.capability_key as CapabilityKey;
    if (included.has(key) && !latestByCapability.has(key)) {
      latestByCapability.set(key, {
        status: run.status,
        at: run.completed_at ?? run.created_at,
      });
    }
  }

  const missingKeys = capabilityKeys.filter(
    (key) => !latestByCapability.has(key),
  );
  const failedKeys = capabilityKeys.filter(
    (key) => latestByCapability.get(key)?.status === "failed",
  );
  const passed = capabilityKeys.filter(
    (key) => latestByCapability.get(key)?.status === "passed",
  ).length;

  return {
    total: capabilityKeys.length,
    passed,
    complete: passed === capabilityKeys.length,
    missingKeys,
    failedKeys,
    latestByCapability,
  };
}

export async function loadFeatureTestProgress(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    packageId: string;
    capabilityKeys: CapabilityKey[];
  },
): Promise<FeatureTestProgress> {
  const { data, error } = await supabase
    .from("client_feature_test_runs")
    .select("capability_key, status, completed_at, created_at")
    .eq("client_id", input.clientId)
    .eq("package_id", input.packageId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Feature verification progress could not be loaded.");
  }

  return featureTestProgress(
    input.capabilityKeys,
    (data ?? []) as FeatureTestProgressRun[],
  );
}
