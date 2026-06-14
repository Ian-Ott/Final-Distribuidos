#!/bin/sh
set -e

echo "[entrypoint] Waiting for database..."
for i in $(seq 1 30); do
  if node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] Database reachable."
    break
  fi
  echo "[entrypoint] DB not ready yet, retrying ($i/30)..."
  sleep 1
done

echo "[entrypoint] Running prisma migrate deploy..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] Starting app: $@"
exec "$@"
