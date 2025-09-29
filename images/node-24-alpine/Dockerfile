FROM node:24-alpine
ARG PACKAGE_MANAGER_MCP_SERVER_VERSION="v0.1.3"
RUN apk update && \
    apk add sudo && \
    wget -O /usr/local/bin/package-manager-mcp-server \
      https://github.com/endorhq/package-manager-mcp/releases/download/v0.1.3/package-manager-mcp-aarch64-unknown-linux-musl && \
    chmod +s+x /usr/local/bin/package-manager-mcp-server
