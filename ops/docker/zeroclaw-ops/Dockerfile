FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    bash \
    && rm -rf /var/lib/apt/lists/*

ARG KUBECTL_VERSION=v1.29.9
ARG HELM_VERSION=v3.14.4

RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" | tar xz -C /tmp \
    && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
    && chmod +x /usr/local/bin/helm \
    && rm -rf /tmp/linux-amd64

COPY --from=ghcr.io/zeroclaw-labs/zeroclaw:latest /usr/local/bin/zeroclaw /usr/local/bin/zeroclaw

COPY entrypoint.sh /entrypoint.sh
COPY health-repair.sh /usr/local/bin/health-repair.sh
COPY failure-watcher.sh /usr/local/bin/failure-watcher.sh

RUN chmod +x /entrypoint.sh /usr/local/bin/health-repair.sh /usr/local/bin/failure-watcher.sh

WORKDIR /zeroclaw-data
ENTRYPOINT ["/entrypoint.sh"]
