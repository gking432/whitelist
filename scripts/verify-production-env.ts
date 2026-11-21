import { productionReadiness } from "../lib/ops/production-readiness.ts";

const result = productionReadiness(process.env);

if (!result.ready) {
  console.error("Production environment is incomplete:");
  for (const issue of result.issues) {
    console.error(`- ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("Production environment verified: required V1 services are configured.");
}
