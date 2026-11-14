# Render copy of ops/Dockerfile for the indexer + API. Build context: the repo root.
# The only difference: no `USER node`. A Render persistent disk is mounted at runtime and may be owned by root,
# so a non-root process could not create /data/indexer.db. Running as root inside the container is acceptable here:
# the process holds no secret, takes no input except HTTP, and the container is already isolated by Render.
# If you change ops/Dockerfile, mirror the change here.
FROM node:24-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1 KRUXA_DB=/data/indexer.db HOST=0.0.0.0
WORKDIR /app
COPY services/indexer/package.json services/indexer/package.json
COPY services/api/package.json services/api/package.json
COPY services/indexer/src services/indexer/src
COPY services/api/src services/api/src
RUN mkdir -p /data
# PORT is injected by the platform (Render sets it, the API reads it); 8787 is only the local default.
CMD ["node", "services/api/src/main.ts"]
