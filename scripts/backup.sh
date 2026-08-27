#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "Arquivo .env nao encontrado. Rode ./scripts/init.sh primeiro." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
. ./.env
set +a

STAMP=$(date +%Y%m%d-%H%M%S)
DEST=${1:-"$ROOT_DIR/backups/$STAMP"}
case "$DEST" in
  /*) ;;
  *) DEST="$ROOT_DIR/$DEST" ;;
esac
mkdir -p "$DEST"

UPLOAD_VOLUME=${GINGA_UPLOAD_VOLUME:-}
if [ -z "$UPLOAD_VOLUME" ]; then
  UPLOAD_VOLUME=$(docker volume ls \
    --filter label=com.docker.compose.project=ginga \
    --filter label=com.docker.compose.volume=uploads_data \
    --format '{{.Name}}' 2>/dev/null | head -n 1 || true)
fi
UPLOAD_VOLUME=${UPLOAD_VOLUME:-ginga_uploads_data}
if ! docker volume inspect "$UPLOAD_VOLUME" >/dev/null 2>&1; then
  echo "Volume de uploads nao encontrado: $UPLOAD_VOLUME" >&2
  echo "Volumes do projeto Ginga:" >&2
  docker volume ls --filter label=com.docker.compose.project=ginga >&2 || true
  exit 1
fi

echo "Exportando PostgreSQL..."
docker compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom > "$DEST/database.dump"

echo "Compactando anexos..."
docker run --rm \
  -v "$UPLOAD_VOLUME:/source:ro" \
  -v "$DEST:/backup" \
  alpine:3.22 sh -c 'tar -czf /backup/uploads.tar.gz -C /source .'

cp .env "$DEST/env.reference"
chmod 600 "$DEST/env.reference"

cat > "$DEST/RESTORE.txt" <<EOF_INNER
Banco:
  cat database.dump | docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"

Uploads (pare a API antes):
  docker compose stop api
  docker run --rm -v "$UPLOAD_VOLUME:/target" -v "$DEST:/backup:ro" alpine:3.22 sh -c 'rm -rf /target/* && tar -xzf /backup/uploads.tar.gz -C /target'
  docker compose start api
EOF_INNER

echo "Backup concluido em: $DEST"
echo "Volume de uploads salvo: $UPLOAD_VOLUME"
