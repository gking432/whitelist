import assert from "node:assert/strict";
import test from "node:test";
import { getAppUrl } from "../lib/env.ts";

const keys = [
  "APP_URL",
  "RENDER_EXTERNAL_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
];

test("hosted sign-in links use the correct environment rather than localhost", () => {
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(getAppUrl(), "http://localhost:3000");
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "build-123.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "agency.example.com";
    assert.equal(getAppUrl(), "https://agency.example.com");
    process.env.VERCEL_ENV = "preview";
    assert.equal(getAppUrl(), "https://build-123.example.com");
    process.env.APP_URL = "https://custom.example.com/";
    assert.equal(getAppUrl(), "https://custom.example.com");
    process.env.APP_URL = "";
    process.env.RENDER_EXTERNAL_URL = "https://agency.onrender.com/";
    assert.equal(getAppUrl(), "https://agency.onrender.com");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
