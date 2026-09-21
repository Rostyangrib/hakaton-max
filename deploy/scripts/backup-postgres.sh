#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_PREFIX:=postgres}"
: "${AWS_ENDPOINT_URL:=https://storage.yandexcloud.net}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="/tmp/quietchat-${timestamp}.dump"
object_uri="s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/quietchat-${timestamp}.dump"

cleanup() {
  rm -f "$backup_file"
}
trap cleanup EXIT INT TERM

pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$DATABASE_URL"
aws --endpoint-url "$AWS_ENDPOINT_URL" s3 cp "$backup_file" "$object_uri" --only-show-errors

echo "PostgreSQL backup uploaded: ${object_uri}"
