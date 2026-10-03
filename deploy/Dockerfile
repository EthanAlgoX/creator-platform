# Build the reviewed JS outputs locally before packaging this image.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /opt/creator-platform
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 creator && useradd --uid 10001 --gid 10001 --no-create-home creator \
    && mkdir /data && chown 10001:10001 /data
WORKDIR /opt/creator-platform
COPY --from=dependencies /opt/creator-platform/node_modules ./node_modules
COPY package.json ./
COPY dist/server/ ./server/
COPY client/dist/ ./client/dist/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 CREATOR_DATA_DIR=/data
USER 10001:10001
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:4318/api/health',{headers:{'X-Creator-Proxy-Token':process.env.CREATOR_PROXY_TOKEN||''}});if(!r.ok||(await r.json()).ok!==true)process.exit(1)"
# An OS lock prevents two publishing queues from sharing one data directory.
ENTRYPOINT ["flock", "--no-fork", "-n", "/data/queue.lock", "node", "server/index.js"]
