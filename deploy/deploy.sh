#!/bin/sh
set -eu

project_dir="${QUIET_CHAT_DIR:-/opt/quiet-chat}"
env_file="${QUIET_CHAT_ENV_FILE:-$project_dir/.env.production}"

cd "$project_dir"

if [ ! -f "$env_file" ]; then
  echo "Production environment file is missing: $env_file" >&2
  exit 1
fi

if [ "${SKIP_GIT_UPDATE:-0}" != "1" ]; then
  git fetch origin feature/quiet-chat-mvp
  git checkout feature/quiet-chat-mvp
  git pull --ff-only origin feature/quiet-chat-mvp
fi

docker compose --env-file "$env_file" -f compose.production.yaml build --pull
docker compose --env-file "$env_file" -f compose.production.yaml up -d --remove-orphans
docker compose --env-file "$env_file" -f compose.production.yaml ps
