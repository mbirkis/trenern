# trenern — self-hosted treningssporing
# Multi-stage: build native deps (better-sqlite3) on a full image, run on slim.

# ---- build stage ----
FROM docker.io/library/node:22-bookworm AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3 when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY config/config.example.json ./config/config.example.json

# ---- runtime stage ----
FROM docker.io/library/node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3005 \
    TRENERN_CONFIG=/app/config/config.json
WORKDIR /app

# Install Python 3 + pip for the Garmin Connect helper (garminconnect package).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/*

# Set up the garmin_client venv inside the container with correct ownership.
COPY scripts/garmin_client ./scripts/garmin_client
RUN python3 -m venv scripts/garmin_client/.venv \
 && scripts/garmin_client/.venv/bin/pip install --no-cache-dir 'garminconnect>=0.3,<1.0' \
 && chown -R node:node scripts/garmin_client/.venv

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/config ./config
COPY package.json ./

# Persisted at runtime: /app/data (database, cache) and /app/config (config.json,
# service-account keys, garmin tokens). Declared as volumes so they are not baked into layers.
RUN mkdir -p /app/data /app/config/keys \
 && chown -R node:node /app/data /app/config
VOLUME ["/app/data", "/app/config"]

USER node
EXPOSE 3005

# Health check is defined in the Quadlet unit (HealthCmd=) so the image can stay
# OCI format. For plain `podman run`, add:
#   --health-cmd 'node -e "fetch(\"http://127.0.0.1:3005/api/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"'

CMD ["node", "src/server.js"]
