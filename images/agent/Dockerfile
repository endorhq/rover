ARG NIX_AI_TOOLS_REV=ea213e13fde802090a4cdec57631e3374d67d78f
FROM node:lts AS agent-builder
COPY . /app
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Build the agent
RUN pnpm install && pnpm build-libs && pnpm --filter @endorhq/agent build
RUN cd ./packages/agent && pnpm pack && mv *.tgz /rover-agent.tgz

FROM node:lts
ARG NIX_AI_TOOLS_REV
ARG TARGETARCH
ARG PACKAGE_MANAGER_MCP_SERVER_VERSION="v0.3.0"
ENV NIX_AI_TOOLS_REV=${NIX_AI_TOOLS_REV}
# This ensures that the user profile is always sourced when we `docker
# exec` manually into the container for manual inspection.
ENV ENV=/etc/profile
RUN apt-get update && \
    apt-get install -y --no-install-recommends bash curl file g++ jq make nix-bin python3 sudo && \
    rm -rf /var/lib/apt/lists/* && \
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh && \
    case ${TARGETARCH} in \
      amd64) ARCH_SUFFIX="x86_64-unknown-linux-musl" ;; \
      arm64) ARCH_SUFFIX="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL -o /usr/local/bin/package-manager-mcp-server \
      https://github.com/endorhq/package-manager-mcp/releases/download/${PACKAGE_MANAGER_MCP_SERVER_VERSION}/package-manager-mcp-${ARCH_SUFFIX} && \
    chmod +s+x /usr/local/bin/package-manager-mcp-server

# Install Node dependencies
COPY --from=agent-builder /rover-agent.tgz /rover-agent.tgz
RUN npm install -g mcp-remote@0.1.37
RUN npm install -g /rover-agent.tgz

COPY ./images/agent/assets/1-sudoers-setup /etc/sudoers.d/1-agent-setup
COPY ./images/agent/assets/2-sudoers-cleanup /etc/sudoers.d/2-agent-cleanup
COPY ./images/agent/assets/rover-agent-install /usr/local/bin/rover-agent-install
RUN chmod u+s,a+x /usr/local/bin/rover-agent-install

# Install agents with special requirements
COPY ./images/agent/assets/nix/nix.conf /etc/nix/nix.conf
