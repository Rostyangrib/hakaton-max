#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates \
  curl \
  docker-compose-v2 \
  docker.io \
  git \
  jq

systemctl enable --now docker
install --directory --owner=yc-user --group=yc-user --mode=0750 /opt/quiet-chat
usermod --append --groups docker yc-user

if ! swapon --show=NAME --noheadings | grep --quiet '^/swapfile$'; then
  if ! fallocate --length 2G /swapfile; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep --quiet '^/swapfile ' /etc/fstab; then
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi

echo "VM bootstrap completed"
