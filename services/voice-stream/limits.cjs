function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function voiceLimits(env) {
  return {
    maxCallSeconds: boundedInteger(env.VOICE_MAX_CALL_SECONDS, 900, 60, 1200),
    maxCallTokens: boundedInteger(env.VOICE_MAX_CALL_TOKENS, 100000, 1000, 250000),
  };
}

module.exports = { voiceLimits };
