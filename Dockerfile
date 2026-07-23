# RelayForge — official container image
# Zero npm dependencies, so this is a lean single-stage build on node:20-alpine.
# Runtime files only: src/, i18n/, package.json (for version), config.example.json (fallback).
# data/ is a VOLUME so runtime-state.json, keystore, and auto-generated relay-token persist across restarts.
# .env and config.json are intentionally NOT baked in — operators mount their own.

# syntax=docker/dockerfile:1
FROM node:20-alpine

LABEL org.opencontainers.image.title="RelayForge" \
      org.opencontainers.image.description="Zero-dependency local-first AI coding gateway with combo routing, fallback, and OpenAI/Anthropic compatibility." \
      org.opencontainers.image.source="https://github.com/jiezeng2004-design/relay-forge" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy runtime-critical files only. Order matters for layer caching:
# rarely-changing files first, frequently-changing source last.
COPY package.json config.example.json ./
COPY src/ ./src/
COPY i18n/ ./i18n/

# Create the data directory and hand it to the non-root `node` user
# (the node:alpine image ships with UID 1000). The VOLUME mount at
# /app/data will inherit these ownership bits on first run.
RUN mkdir -p /app/data && chown -R node:node /app

# Drop privileges — never run the relay as root inside the container.
USER node

# Persist runtime-state.json, the keystore, and the auto-generated
# relay-token here so a container restart keeps its auth material.
VOLUME ["/app/data"]

EXPOSE 18765

# Lightweight liveness probe: /health is an unauthenticated GET that
# returns { ok: true, startedAt, version }. 30s start-period gives
# Node.js time to load config and bind the port on cold hosts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18765/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --root=/app makes detectRuntimeRootDir deterministic regardless of
# how the image is invoked (docker run, compose, k8s).
CMD ["node", "src/server.js", "--root=/app"]
