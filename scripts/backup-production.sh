#!/usr/bin/env bash
set -euo pipefail

data_root="${CYCLE_DATA_ROOT:-/var/lib/campus-cycle-station}"
database_path="${CYCLE_DB_PATH:-${data_root}/data/campus-cycle-station.sqlite}"
backup_root="${CYCLE_BACKUP_ROOT:-/var/backups/campus-cycle-station}"
node_binary="${NODE_BINARY:-/usr/local/bin/node}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_root}/${timestamp}"

umask 077
test -f "${database_path}"
mkdir -p "${target}"

"${node_binary}" --input-type=module - "${database_path}" "${target}/campus-cycle-station.sqlite" <<'NODE'
import { backup, DatabaseSync } from 'node:sqlite';
const [sourcePath, destinationPath] = process.argv.slice(2);
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(source, destinationPath);
} finally {
  source.close();
}
NODE

tar -C "${data_root}" -czf "${target}/uploads.tar.gz" uploads
tar -C "${data_root}" -czf "${target}/generated.tar.gz" generated
sha256sum "${target}/campus-cycle-station.sqlite" "${target}/uploads.tar.gz" "${target}/generated.tar.gz" > "${target}/SHA256SUMS"
printf '%s\n' "${target}"
