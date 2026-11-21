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

# Initial platform administrator provisioning is an explicit one-time CLI action.
# Never create or reset administrator accounts automatically during API startup.

echo "Launching API server on port ${API_PORT:-4000}..."
exec node apps/api/dist/server.js
