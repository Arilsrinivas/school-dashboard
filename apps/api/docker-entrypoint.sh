#!/bin/sh
set -e

echo "Starting CalmStacks EduConnect API..."

# Run database migrations if enabled (default true)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  node apps/api/dist/db/migrate.js || {
    echo "Warning: Migration command exited with error. Retrying in 3 seconds..."
    sleep 3
    node apps/api/dist/db/migrate.js
  }
  echo "Database migrations applied successfully."
fi

# Run bootstrap platform administrator if configured
if [ -n "$BOOTSTRAP_ADMIN_EMAIL" ] && [ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
  echo "Checking bootstrap platform administrator..."
  node apps/api/dist/auth/bootstrap.js || echo "Bootstrap admin already configured or skipped."
fi

echo "Launching API server on port ${API_PORT:-4000}..."
exec node apps/api/dist/server.js
