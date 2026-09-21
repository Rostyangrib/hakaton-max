# Production deployment in Yandex Cloud

## Target topology

- One regular Ubuntu VM: 2 vCPU at 20% guaranteed share, 2 GB RAM, 2 GB swap and a 20 GB network HDD in `ru-central1-d`.
- A reserved public IPv4 address and an `IP.sslip.io` HTTPS hostname.
- The existing `default` VPC is used because this cloud has exhausted its quota of two networks; isolation is enforced by a dedicated security group and Docker networks.
- Docker Compose services: Caddy, API, worker, PostgreSQL, cleanup and backup.
- Only TCP 22 (administrator IP), TCP 80/443 and UDP 443 are exposed by the security group.
- PostgreSQL and maintenance services are available only on the internal Docker network.
- Secrets are stored in Yandex Lockbox and materialized as `/opt/quiet-chat/.env.production` with mode `0640` on the VM.
- Daily PostgreSQL custom-format backups are uploaded to a private Object Storage bucket and removed after seven days by a bucket lifecycle rule.

## Why no purchased domain is required for the MVP

`sslip.io` resolves a hostname containing the VM public IP back to that IP. Caddy can therefore obtain a public TLS certificate for a name such as `203-0-113-10.sslip.io`. This is suitable for an MVP and MAX webhook/Mini App testing. A project-owned domain is recommended before a long-lived public launch because the hostname changes when the IP changes and depends on an external wildcard DNS service.

## Required secrets

Do not paste secrets into Git, cloud-init, shell history, CI variables printed in logs or this document. Rotate the MAX token and Yandex API key that were previously sent through chat before production use.

Lockbox must contain the values represented by `.env.production.example`, including generated PostgreSQL, session and webhook secrets and the Object Storage static access key. The deployed `.env.production` must never be committed.

## Provisioning sequence

1. Install and initialize the official `yc` CLI.
2. Select the required cloud and folder.
3. Select a subnet in the existing VPC and create a dedicated security group. A separate VPC is preferred when quota permits it.
4. Reserve a public IPv4 address.
5. Create a VM service account. Grant only `lockbox.payloadViewer` and the minimum Object Storage access required for the backup bucket.
6. Create a private Object Storage bucket, configure the lifecycle from `deploy/object-storage-lifecycle.json`, and create a static access key for backups.
7. Create a Lockbox secret and enter rotated application credentials through the Yandex Cloud console or a local, non-logged command.
8. Create the Ubuntu VM with the service account and reserved address; deliver the selected public GitHub branch through cloud-init.
9. Copy the release to `/opt/quiet-chat`, run `sudo sh deploy/scripts/bootstrap-vm.sh`, then materialize the environment with `sudo sh deploy/scripts/materialize-lockbox-env.sh <LOCKBOX_SECRET_ID>`.
10. Run `sudo sh deploy/deploy.sh`.
11. Verify `https://<PUBLIC_HOST>/health/ready` and the Mini App page.
12. Register `https://<PUBLIC_HOST>/webhooks/max` as the MAX webhook using the same webhook secret.
13. Configure `https://<PUBLIC_HOST>` as the Mini App URL in the MAX partner settings.

## Runtime commands

```sh
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 api worker gateway
curl --fail --silent --show-error https://$PUBLIC_HOST/health/ready
```

For an initial deployment from an uploaded working-tree archive before the branch is committed, use `sudo SKIP_GIT_UPDATE=1 sh deploy/deploy.sh`. Subsequent deployments must use the normal Git update path.

Manual maintenance checks:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec cleanup /opt/quiet-chat/scripts/cleanup-data.sh
docker compose --env-file .env.production -f compose.production.yaml exec backup /opt/quiet-chat/scripts/backup-postgres.sh
```

Restore drill into an empty database:

```sh
pg_restore --list quietchat-YYYYMMDDTHHMMSSZ.dump
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" quietchat-YYYYMMDDTHHMMSSZ.dump
```

## MAX activation notes

- The webhook endpoint must be public HTTPS on port 443 and Caddy must have obtained a trusted certificate before registration.
- The API validates `X-Max-Bot-Api-Secret`; the registration request must use the same secret.
- `MAX_HOME_CHAT_ID` remains empty until a test group is created and the bot is added. Read the chat ID from the resulting `bot_added` webhook event, then update Lockbox and restart API/worker.
- The bot never sends application messages to the group; alerts and summaries use private user dialogs only.

## Resources created for the MVP

- Zone: `ru-central1-d`.
- Service account: `quiet-chat-vm`.
- Lockbox secret: `quiet-chat-production` (deletion protection enabled).
- Private bucket: `quiet-chat-backups-b1ge00tftjithijbde7u`, maximum size 5 GiB.
- Reserved address: `quiet-chat-public-ip` (`81.26.184.200`, detached) and `quiet-chat-public-ip-active` (`158.160.237.183`, reserved static address with deletion protection); active hostname `158-160-237-183.sslip.io` configured with automated Let's Encrypt TLS.
- VM: `quiet-chat`, regular (not preemptible), `standard-v3`, 2 vCPU at 20%, 2 GB RAM and 20 GB network HDD.
- Security group: `quiet-chat-sg`; HTTP/HTTPS are public, SSH restricted to admin IP.
- Webhook management: `deploy/scripts/manage-webhook.sh` handles status, registration, and removal via MAX Bot API.

Resource identifiers and secret payload values are intentionally not required in Git-tracked configuration. Query IDs by resource name during deployment.

## Retention and incident handling

- Messages: 30 days.
- Raw webhook events: 7 days.
- Generated summaries and summary jobs: 30 days.
- Database backups: 7 days.

The cleanup transaction deletes dependent alert deliveries through existing database foreign keys. If a credential is exposed, rotate it in its source service, update Lockbox, rematerialize `.env.production`, and recreate the affected containers.
