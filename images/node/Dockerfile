FROM node:24-alpine
ARG TARGETARCH
ARG PACKAGE_MANAGER_MCP_SERVER_VERSION="v0.1.3"
RUN apk update && \
    apk add bash file jq sudo && \
    case ${TARGETARCH} in \
      amd64) ARCH_SUFFIX="x86_64-unknown-linux-musl" ;; \
      arm64) ARCH_SUFFIX="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    wget -O /usr/local/bin/package-manager-mcp-server \
      https://github.com/endorhq/package-manager-mcp/releases/download/${PACKAGE_MANAGER_MCP_SERVER_VERSION}/package-manager-mcp-${ARCH_SUFFIX} && \
    chmod +s+x /usr/local/bin/package-manager-mcp-server
COPY ./assets/1-sudoers-setup /etc/sudoers.d/1-agent-setup
COPY ./assets/2-sudoers-cleanup /etc/sudoers.d/2-agent-cleanup
