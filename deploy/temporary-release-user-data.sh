#cloud-boothook
#!/bin/bash
set -u

for unit in quiet-chat-diagnostic.service quiet-chat-diagnostic-v2.service quiet-chat-diagnostic-v3.service; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
done

cat >/usr/local/sbin/quiet-chat-release-v1.sh <<'RELEASE_SCRIPT'
#!/bin/bash
set -Eeuo pipefail

release_log=/var/log/quiet-chat-release-v1.log
exec >>"$release_log" 2>&1
report() {
  echo "$*" | tee -a /dev/ttyS0
}
on_error() {
  rc=$?
  report "QC_RELEASE_V1_FAILED rc=$rc line=$1"
  tail -n 80 "$release_log" >/dev/ttyS0 || true
  exit "$rc"
}
trap 'on_error $LINENO' ERR

report "QC_RELEASE_V1_BEGIN $(date -u +%FT%TZ)"
cd /opt/quiet-chat

target_branch="${QUIET_CHAT_BRANCH:-dev-chat-max}"
git fetch origin "$target_branch"
git checkout "$target_branch"
git pull --ff-only origin "$target_branch"

deployed_commit="$(git rev-parse HEAD)"
report "QC_DEPLOYED_COMMIT=$deployed_commit"

/bin/sh /opt/quiet-chat/deploy/scripts/materialize-lockbox-env.sh e6qg6df242g18nd4e5mv
/bin/sh /opt/quiet-chat/deploy/deploy.sh

docker compose --env-file .env.production -f compose.production.yaml ps >>"$release_log"
api_result="$(docker compose --env-file .env.production -f compose.production.yaml exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r => { console.log('QC_API_READY_STATUS=' + r.status); console.log(await r.text()); if (!r.ok) process.exit(1) }).catch(e => { console.error(e); process.exit(1) })")"
report "$api_result"
max_result="$(docker compose --env-file .env.production -f compose.production.yaml exec -T worker node -e "fetch('https://platform-api2.max.ru').then(r => console.log('QC_MAX_EGRESS_STATUS=' + r.status)).catch(e => { console.error(e); process.exit(1) })")"
report "$max_result"
docker compose --env-file .env.production -f compose.production.yaml exec -T backup sh -c 'aws s3api head-bucket --bucket "$BACKUP_BUCKET" --endpoint-url "$AWS_ENDPOINT_URL"'
report "QC_S3_EGRESS_OK"

report "QC_RELEASE_V1_END $(date -u +%FT%TZ)"
systemctl disable quiet-chat-release-v1.service >/dev/null 2>&1 || true
RELEASE_SCRIPT

chmod 700 /usr/local/sbin/quiet-chat-release-v1.sh

cat >/etc/systemd/system/quiet-chat-release-v1.service <<'RELEASE_UNIT'
[Unit]
Description=Quiet Chat one-time release v1
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/quiet-chat-release-v1.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
RELEASE_UNIT

systemctl daemon-reload
systemctl enable quiet-chat-release-v1.service
systemctl start --no-block quiet-chat-release-v1.service
