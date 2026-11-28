# レビューの席が roster review run で試験と build を流す image（rust の repo 用。e2e の node と pnpm も入れる。t-n4j9 の段 3）。
# 作るのは roster review image build（名は roster-review-rust:<この file の中身の hash>）。版は repo の rust-toolchain.toml に合わせる。
FROM docker.io/library/node:26-bookworm-slim AS node
FROM docker.io/library/rust:1.100-slim-bookworm
# procps: 試験が kill を使う（段 0 の 4。castlist の runlog の試験）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates pkg-config procps \
 && rm -rf /var/lib/apt/lists/*
RUN rustup component add rustfmt clippy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && npm install -g pnpm@11.26.0 && pnpm --version
# cargo の取り込んだ .crate と index は、課題ごとの cache の folder（/cache/cargo）に向ける（registry/src は container ごと）。
ENV CI=true npm_config_store_dir=/cache/pnpm pnpm_config_store_dir=/cache/pnpm
WORKDIR /work
