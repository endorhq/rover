ARG NIX_AI_TOOLS_REV=ea213e13fde802090a4cdec57631e3374d67d78f
FROM node:24-alpine AS agent-builder
COPY . /app
WORKDIR /app

# Build the agent
RUN npm install && npm run build:agent
RUN cd ./packages/agent && npm pack && mv *.tgz /rover-agent.tgz

FROM node:24-alpine
ARG NIX_AI_TOOLS_REV
ARG TARGETARCH
ARG PACKAGE_MANAGER_MCP_SERVER_VERSION="v0.2.0"
ENV NIX_AI_TOOLS_REV=${NIX_AI_TOOLS_REV}
RUN apk update && \
    apk add bash file g++ jq make nix python3 sudo uv && \
    case ${TARGETARCH} in \
      amd64) ARCH_SUFFIX="x86_64-unknown-linux-musl" ;; \
      arm64) ARCH_SUFFIX="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    wget -O /usr/local/bin/package-manager-mcp-server \
      https://github.com/endorhq/package-manager-mcp/releases/download/${PACKAGE_MANAGER_MCP_SERVER_VERSION}/package-manager-mcp-${ARCH_SUFFIX} && \
    chmod +s+x /usr/local/bin/package-manager-mcp-server

# Install Node dependencies
COPY --from=agent-builder /rover-agent.tgz /rover-agent.tgz
RUN npm install -g mcp-remote@0.1.29
RUN npm install -g /rover-agent.tgz

COPY ./images/agent/assets/1-sudoers-setup /etc/sudoers.d/1-agent-setup
COPY ./images/agent/assets/2-sudoers-cleanup /etc/sudoers.d/2-agent-cleanup

# Install agents with special requirements
COPY ./images/agent/assets/nix/nix.conf /etc/nix/nix.conf
COPY ./images/agent/assets/nix/ai-tool-wrapper /usr/local/bin/cursor-agent
