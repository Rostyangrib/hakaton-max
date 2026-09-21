#!/bin/sh
set -eu

secret_id="${1:?Usage: materialize-lockbox-env.sh SECRET_ID [OUTPUT_FILE]}"
output_file="${2:-/opt/quiet-chat/.env.production}"
metadata_url="http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"
payload_url="https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets/${secret_id}/payload"
temp_file="$(mktemp)"

cleanup() {
  rm -f "$temp_file"
}
trap cleanup EXIT INT TERM

iam_token="$(curl --fail --silent --show-error \
  --header 'Metadata-Flavor: Google' \
  "$metadata_url" | jq --exit-status --raw-output '.access_token')"

curl --fail --silent --show-error \
  --header "Authorization: Bearer ${iam_token}" \
  "$payload_url" \
  | jq --exit-status --raw-output '.entries[] | "\(.key)=\(.textValue)"' \
  > "$temp_file"

if grep --quiet '=REPLACE_' "$temp_file"; then
  echo "Lockbox still contains replacement markers" >&2
  exit 1
fi

required_keys='PUBLIC_HOST POSTGRES_PASSWORD SESSION_SECRET MAX_WEBHOOK_SECRET MAX_BOT_TOKEN MAX_HOME_CHAT_ID YANDEX_CLOUD_FOLDER_ID YANDEX_CLOUD_API_KEY BACKUP_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY'
for required_key in $required_keys; do
  if ! grep --quiet "^${required_key}=" "$temp_file"; then
    echo "Lockbox entry is missing: ${required_key}" >&2
    exit 1
  fi
done

install --owner=root --group=docker --mode=0640 "$temp_file" "$output_file"
echo "Production environment materialized from Lockbox"
