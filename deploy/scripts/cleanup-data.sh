#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${MESSAGE_RETENTION_DAYS:=30}"
: "${WEBHOOK_RETENTION_DAYS:=7}"
: "${SUMMARY_RETENTION_DAYS:=30}"

case "$MESSAGE_RETENTION_DAYS:$WEBHOOK_RETENTION_DAYS:$SUMMARY_RETENTION_DAYS" in
  *[!0-9:]*|:*|*::*|*:) echo "Retention periods must be positive integers" >&2; exit 1 ;;
esac

for retention_days in "$MESSAGE_RETENTION_DAYS" "$WEBHOOK_RETENTION_DAYS" "$SUMMARY_RETENTION_DAYS"; do
  if [ "$retention_days" -lt 1 ]; then
    echo "Retention periods must be at least one day" >&2
    exit 1
  fi
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v message_days="$MESSAGE_RETENTION_DAYS" \
  -v webhook_days="$WEBHOOK_RETENTION_DAYS" \
  -v summary_days="$SUMMARY_RETENTION_DAYS" <<'SQL'
begin;
delete from messages
where sent_at < now() - make_interval(days => :'message_days');
delete from webhook_events
where created_at < now() - make_interval(days => :'webhook_days');
delete from summary_jobs
where created_at < now() - make_interval(days => :'summary_days');
commit;
SQL

echo "Data retention cleanup completed"
