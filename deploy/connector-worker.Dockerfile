FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY lib/integrations/codex-worker.ts ./lib/integrations/codex-worker.ts
COPY lib/integrations/connector-worker-config.ts ./lib/integrations/connector-worker-config.ts
COPY lib/integrations/connector-task-runner.ts ./lib/integrations/connector-task-runner.ts
COPY services/connector-worker/worker.ts ./services/connector-worker/worker.ts

RUN mkdir -p /worktrees && chown node:node /worktrees

USER node
CMD ["node", "--experimental-strip-types", "services/connector-worker/worker.ts"]
