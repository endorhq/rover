# Agent images

Agents in Rover run in isolated environments ([sandbox](https://docs.endor.dev/rover/concepts/sandbox/)). These environments give agents a way to modify the environment to improve, implement, build, check, and test a given project, without impacting the host machine. Rover uses Debian Linux as the base image for the default sandbox images we provide. The main reason is to keep these images minimal and give agents access to a rich package ecosystem (`apt-get`).

## Agent images

There are two types of images: development and tagged images. In general, the development images are used. Tagged images are only used when a new rover release is created.

### Base image

The base image is Debian as it is a good fit for Agents in the spirit of being developer friendly, and because it uses glibc natively which ensures broad compatibility with prebuilt binaries and tools. It also has a very rich [package offering](https://packages.debian.org/).

The base image is built with the following [Dockerfile](../images/agent/Dockerfile).

#### Agent installation

In general, when a new agent session is requested within the container, we install it with `npm install -g` or with the instructions provided by the Agent maintainers.

### Development images

The code at the `main` branch points to `ghcr.io/endorhq/rover/agent-dev:latest`. Automation builds and pushes to this image when a new commit is pushed to the `main` branch.

### Tagged images

Whenever we create a new tag in Rover, a new image will be pushed with that tag name at: `ghcr.io/endorhq/rover/agent:<tag>`.

Note that tagged images are named `agent` as opposed to development images that are named `agent-dev`. This is so that when a new tag is pushed to the `ghcr.io/endorhq/rover/agent` image, the `ghcr.io/endorhq/rover/agent-dev:latest` image is not affected.

#### Release

Releasing a new tag for an image is done through the [Release workflow](../.github/workflows/release.yml). This workflow will tag the source code, as well as build a new agent image, with the source code updated to point to that agent image

## Develop a new agent image

Some changes might require updating the `rover-agent` CLI that runs in the container during development, or we might want to update the base image or perform some changes to it. In that case, a new image of the `rover-agent` image has to be built.

### Minimum image requirements

In case that you are experimenting to build a very different agent image than the current one, the minimum requirements for the image follows.

#### Node

Regardless of the base image you use, Node 24 is a prerequisite, as [`rover-agent`](https://github.com/endorhq/rover/tree/main/packages/agent) is a Node application.

#### Package Manager MCP

The [package-manager MCP](https://github.com/endorhq/package-manager-mcp) is a static binary that allows the configured agent to search and install packages in the container.

It is expected that a binary named `package-manager-mcp-server` exists in the `$PATH`. It will be configured during the agent set up phase.

You can find the static binaries in the [Releases list](https://github.com/endorhq/package-manager-mcp/releases).

#### Reserved directories

Reserved directories may or may not exist in the container image. However, their original contents won't be available during Agent execution, as host paths will be mounted in these directories automatically by Rover.

- `/workspace`: mountpoint used for the user project.

- `/output`: mountpoint used by Rover to follow the task progress.

#### Sudo

`sudo` needs to be available in the system. The reason behind this decision is because we need to run Agents in an unattended mode so that they can finish the task without asking many intermediate questions. However, usually, inside a container, we are identified as the `root` user. Many agents will refuse to run if they are super user, so that we run the agent with an unprivileged user, and use `sudo` with it.

In rootless containers, we do use `sudo` as well.

The Rover agent CLI goes through two main steps:

1. Setting up the environment and installing system dependencies
2. Running the chosen agent

Ideally, there should be two `sudo` profiles:

- `/etc/sudoers.d/1-agent-setup`
- `/etc/sudoers.d/2-agent-cleanup`

The contents of this files will depend on the default groups present in the base image to be configured for Rover. However, a good rule of thumb is to take `/etc/group` from the base and configure both accordingly, adding an extra group `agent` that will be created automatically by Rover if necessary.

Rover will remove `/etc/sudoers.d/1-agent-setup` before handing control to the agent. From that point on, the
`/etc/sudoers.d/2-agent-cleanup` will determine what the agent is able to do with `sudo`: it is highly recommended to reduce the list of commands that could be executed with root permissions without password.

An example for `node:lts` follows:

<details>

<summary>/etc/sudoers.d/1-agent-setup</summary>

```
# Rover agent group; if there is no matching gid within the container
# with the host gid, the `agent` group will be used.

%agent ALL=(ALL) NOPASSWD: ALL

# Original image group list at /etc/group. If the host user gid
# matches with any of them, it will be able to use `sudo` normally
# within the container.

%root ALL=(ALL) NOPASSWD: ALL
%daemon ALL=(ALL) NOPASSWD: ALL
%bin ALL=(ALL) NOPASSWD: ALL
%sys ALL=(ALL) NOPASSWD: ALL
%adm ALL=(ALL) NOPASSWD: ALL
%tty ALL=(ALL) NOPASSWD: ALL
%disk ALL=(ALL) NOPASSWD: ALL
%lp ALL=(ALL) NOPASSWD: ALL
%mail ALL=(ALL) NOPASSWD: ALL
%news ALL=(ALL) NOPASSWD: ALL
%man ALL=(ALL) NOPASSWD: ALL
%proxy ALL=(ALL) NOPASSWD: ALL
%audio ALL=(ALL) NOPASSWD: ALL
%cdrom ALL=(ALL) NOPASSWD: ALL
%dialout ALL=(ALL) NOPASSWD: ALL
%floppy ALL=(ALL) NOPASSWD: ALL
%fax ALL=(ALL) NOPASSWD: ALL
%voice ALL=(ALL) NOPASSWD: ALL
%ftp ALL=(ALL) NOPASSWD: ALL
%dip ALL=(ALL) NOPASSWD: ALL
%backup ALL=(ALL) NOPASSWD: ALL
%operator ALL=(ALL) NOPASSWD: ALL
%list ALL=(ALL) NOPASSWD: ALL
%irc ALL=(ALL) NOPASSWD: ALL
%gnats ALL=(ALL) NOPASSWD: ALL
%src ALL=(ALL) NOPASSWD: ALL
%video ALL=(ALL) NOPASSWD: ALL
%sasl ALL=(ALL) NOPASSWD: ALL
%plugdev ALL=(ALL) NOPASSWD: ALL
%staff ALL=(ALL) NOPASSWD: ALL
%games ALL=(ALL) NOPASSWD: ALL
%shadow ALL=(ALL) NOPASSWD: ALL
%sudo ALL=(ALL) NOPASSWD: ALL
%www-data ALL=(ALL) NOPASSWD: ALL
%users ALL=(ALL) NOPASSWD: ALL
%crontab ALL=(ALL) NOPASSWD: ALL
%messagebus ALL=(ALL) NOPASSWD: ALL
%_ssh ALL=(ALL) NOPASSWD: ALL
%sgx ALL=(ALL) NOPASSWD: ALL
%render ALL=(ALL) NOPASSWD: ALL
%nogroup ALL=(ALL) NOPASSWD: ALL
%nobody ALL=(ALL) NOPASSWD: ALL
%node ALL=(ALL) NOPASSWD: ALL
%nix ALL=(ALL) NOPASSWD: ALL
%nixbld ALL=(ALL) NOPASSWD: ALL
```

</details>

<details>

<summary>/etc/sudoers.d/2-agent-cleanup</summary>

```
# Rover agent group; if there is no matching gid within the container
# with the host gid, the `agent` group will be used.

%agent ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee

# Original image group list at /etc/group. If the host user gid
# matches with any of them, it will be able to use `sudo` normally
# within the container.

%root ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%daemon ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%bin ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sys ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%adm ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%tty ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%disk ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%lp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%mail ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%news ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%man ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%proxy ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%audio ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%cdrom ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%dialout ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%floppy ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%fax ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%voice ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ftp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%dip ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%backup ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%operator ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%list ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%irc ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%gnats ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%src ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%video ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sasl ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%plugdev ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%staff ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%games ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%shadow ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sudo ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%www-data ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%users ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%crontab ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%messagebus ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%_ssh ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sgx ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%render ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nogroup ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nobody ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%node ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nix ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nixbld ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
```

</details>

## Using a Custom Agent Image

### Configuration

To use a custom agent image, configure it in your `rover.json` file inside the `sandbox` section:

```json
{
  "version": "1.2",
  "sandbox": {
    "agentImage": "your-custom-image:tag"
  }
}
```

Rover will display a warning when using a custom image:

```
⚠ Note: Using custom agent image: your-custom-image:tag
  This might have side effects on the expected behavior of Rover if this image is incompatible
  with the reference image: ghcr.io/endorhq/rover/agent-dev:latest
```

### Environment Variable Override

You can also override the image using the `AGENT_IMAGE` environment variable (takes precedence over `rover.json`):

```bash
AGENT_IMAGE=your-custom-image:tag rover task "Your task description"
```

### Building from Source

To build a custom agent image from the Rover repository:

```bash
# From the repo root
docker build -t my-rover-agent:latest -f images/agent/Dockerfile .
```

Then configure it in your project's `rover.json`:

```json
{
  "version": "1.2",
  "sandbox": {
    "agentImage": "my-rover-agent:latest"
  }
}
```
