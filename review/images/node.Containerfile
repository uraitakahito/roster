# レビューの席が roster review run で試験と build を流す image（node の repo 用。t-n4j9 の段 3）。
# 作るのは roster review image build（名は roster-review-node:<この file の中身の hash>）。版は repo の .node-version・packageManager に合わせる。
FROM docker.io/library/node:26-bookworm-slim
# procps: 試験が kill・ps を使う（段 0 の 4。roster の mail-wait-sh の試験）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*
# node 26 は corepack を同梱しないので、pnpm は npm で入れる。store は課題ごとの cache の folder（/cache/pnpm）に向ける。
RUN npm install -g pnpm@11.26.0 && pnpm --version
ENV CI=true npm_config_store_dir=/cache/pnpm pnpm_config_store_dir=/cache/pnpm
WORKDIR /work
