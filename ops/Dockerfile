# Kruxa indexer + API: one process, one SQLite file on a persistent volume.
# Build from the repo root:  docker build -f ops/Dockerfile -t kruxa-indexer .
# Run:  docker run -v kruxa-data:/data -e KRUXA_NETWORK=testnet -e KRUXA_CORE=<core account> -e KRUXA_MARKET=<market account> -p 8787:8787 kruxa-indexer
# Zero runtime dependencies: Node 24 strips TypeScript types and ships node:sqlite.
FROM node:24-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1 KRUXA_DB=/data/indexer.db PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY services/indexer/package.json services/indexer/package.json
COPY services/api/package.json services/api/package.json
COPY services/indexer/src services/indexer/src
COPY services/api/src services/api/src
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/api/src/main.ts"]
