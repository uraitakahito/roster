# pagestore の image。build の段で静的な binary を作り、動かす段は空の image に binary 1 つだけを置く。
# build の段の Rust の版は rust-toolchain.toml と合わせる（合わないと、build の中で別の版を取りに行く）。
FROM docker.io/library/rust:1.100.0-alpine@sha256:8d0e82abfdf9a38071e07cabc5afba4ddbe077631a80e4e742a760c38beadc33 AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY . .
# SQL の検査は commit した .sqlx/ で行う（build の中に DB は無い）。
ENV SQLX_OFFLINE=true
RUN cargo build --release --locked && mkdir /data

FROM scratch
COPY --from=build /src/target/release/pagestore /pagestore
# DB の置き場。動かす時に volume を付ける。
COPY --from=build /data /data
ENV PAGESTORE_DB=/data/pages.db PAGESTORE_LISTEN=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["/pagestore"]
