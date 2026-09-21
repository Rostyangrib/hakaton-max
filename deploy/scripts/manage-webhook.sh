#!/bin/sh
set -eu

project_dir="${QUIET_CHAT_DIR:-/opt/quiet-chat}"
env_file="${QUIET_CHAT_ENV_FILE:-$project_dir/.env.production}"

cd "$project_dir"

if [ ! -f "$env_file" ]; then
  echo "Environment file is missing: $env_file" >&2
  exit 1
fi

action="${1:-status}"

case "$action" in
  status)
    echo "Checking MAX webhook subscriptions..."
    docker compose --env-file "$env_file" -f compose.production.yaml exec -T -w /app/apps/api api node --input-type=module -e '
      import { Bot } from "@maxhub/max-bot-api";
      const bot = new Bot(process.env.MAX_BOT_TOKEN);
      const subs = await bot.api.getSubscriptions();
      console.log("Active MAX subscriptions:", JSON.stringify(subs, null, 2));
    '
    ;;
  me)
    echo "Getting bot info..."
    docker compose --env-file "$env_file" -f compose.production.yaml exec -T -w /app/apps/api api node --input-type=module -e '
      import { Bot } from "@maxhub/max-bot-api";
      const bot = new Bot(process.env.MAX_BOT_TOKEN);
      const me = await bot.api.getMyInfo();
      console.log("MAX Bot Info:", JSON.stringify(me, null, 2));
    '
    ;;
  register)
    echo "Registering MAX webhook subscription..."
    docker compose --env-file "$env_file" -f compose.production.yaml exec -T -w /app/apps/api api node --input-type=module -e '
      import { Bot } from "@maxhub/max-bot-api";
      const bot = new Bot(process.env.MAX_BOT_TOKEN);
      const host = process.env.PUBLIC_HOST || (process.env.WEB_ORIGIN ? new URL(process.env.WEB_ORIGIN).host : "");
      if (!host) {
        console.error("PUBLIC_HOST or WEB_ORIGIN is not configured");
        process.exit(1);
      }
      const url = `https://${host}/webhooks/max`;
      const secret = process.env.MAX_WEBHOOK_SECRET;
      console.log(`Subscribing MAX webhook to: ${url}`);
      const res = await bot.api.subscribe(url, secret);
      console.log("Subscribe result:", res);
      const subs = await bot.api.getSubscriptions();
      console.log("Active subscriptions:", JSON.stringify(subs, null, 2));
    '
    ;;
  unregister)
    echo "Unregistering all MAX webhook subscriptions..."
    docker compose --env-file "$env_file" -f compose.production.yaml exec -T -w /app/apps/api api node --input-type=module -e '
      import { Bot } from "@maxhub/max-bot-api";
      const bot = new Bot(process.env.MAX_BOT_TOKEN);
      const subs = await bot.api.getSubscriptions();
      for (const sub of subs) {
        console.log(`Unsubscribing: ${sub.url}`);
        await bot.api.unsubscribe(sub.url);
      }
      console.log("All subscriptions cleared.");
    '
    ;;
  *)
    echo "Usage: $0 [status|me|register|unregister]" >&2
    exit 1
    ;;
esac
