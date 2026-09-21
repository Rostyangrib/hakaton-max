#!/bin/sh
set -eu

: "${MAINTENANCE_INTERVAL_SECONDS:=86400}"

while true; do
  /opt/quiet-chat/scripts/cleanup-data.sh
  sleep "$MAINTENANCE_INTERVAL_SECONDS"
done
