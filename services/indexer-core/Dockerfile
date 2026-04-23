# Stage 1: Builder
FROM rust:1.88-slim as builder

WORKDIR /app

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

# Install dependencies
RUN apt-get update && apt-get install -y \
    g++ \
    make \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY services/indexer-core/Cargo.toml ./
COPY services/indexer-core/Cargo.lock ./
COPY shared/Cargo.toml /shared/Cargo.toml
COPY shared/src /shared/src

# Copy actual source
COPY services/indexer-core/src ./src

# Build actual application
RUN cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/indexer /usr/local/bin/indexer

# Run as non-root user
RUN useradd -m -u 1000 indexer && chown -R indexer:indexer /app
USER indexer

CMD ["indexer"]
