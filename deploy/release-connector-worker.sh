#!/usr/bin/env bash
set -euo pipefail

release_sha="${RELEASE_SHA:-}"
workspace="${CONNECTOR_WORKSPACE_PATH:-}"
env_file="${CONNECTOR_WORKER_ENV_FILE:-}"

if [[ ! "$release_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "RELEASE_SHA must be a full lowercase Git commit SHA." >&2
  exit 1
fi
if [[ -z "$workspace" || "$workspace" != /* ]]; then
  echo "CONNECTOR_WORKSPACE_PATH must be an absolute path." >&2
  exit 1
fi
if [[ -z "$env_file" || "$env_file" != /* || ! -f "$env_file" ]]; then
  echo "CONNECTOR_WORKER_ENV_FILE must point to an existing absolute file." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the Compose v2 plugin is required." >&2
  exit 1
fi
if ! git -C "$workspace" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "CONNECTOR_WORKSPACE_PATH must be an existing Git checkout." >&2
  exit 1
fi
if [[ -n "$(git -C "$workspace" status --porcelain)" ]]; then
  echo "The connector-worker source checkout has local changes; refusing deployment." >&2
  exit 1
fi

git -C "$workspace" fetch --no-tags origin "$release_sha"
if [[ "$(git -C "$workspace" rev-parse FETCH_HEAD)" != "$release_sha" ]]; then
  echo "The fetched connector-worker release does not match RELEASE_SHA." >&2
  exit 1
fi
git -C "$workspace" switch --detach "$release_sha"
git -C "$workspace" worktree prune

export RELEASE_SHA="$release_sha"
export CONNECTOR_WORKSPACE_PATH="$workspace"
export CONNECTOR_WORKER_ENV_FILE="$env_file"

docker compose \
  --project-name northstar-connector-worker \
  --file "$workspace/docker-compose.connector-worker.yml" \
  up --detach --build --remove-orphans

container_id="$(docker compose \
  --project-name northstar-connector-worker \
  --file "$workspace/docker-compose.connector-worker.yml" \
  ps --quiet connector-worker)"
if [[ -z "$container_id" ]]; then
  echo "Connector-worker container did not start." >&2
  exit 1
fi

for _ in {1..30}; do
  state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  if [[ "$state" == "running" ]]; then
    echo "Connector worker is running release $release_sha."
    exit 0
  fi
  if [[ "$state" == "exited" || "$state" == "dead" ]]; then
    docker logs "$container_id" >&2 || true
    echo "Connector-worker container stopped during deployment." >&2
    exit 1
  fi
  sleep 1
done

docker logs "$container_id" >&2 || true
echo "Connector-worker container did not reach running state." >&2
exit 1
