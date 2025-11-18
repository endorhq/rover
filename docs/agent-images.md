# Agent images

Agents in Rover run in isolated environments, as much as possible. The
idea behind this strategy is that the agent can make as many changes
as it needs in order to improve, implement, build, check, test... on a
given project, without impacting the host machine.

When Rover runs, it is possible to choose what image will be used to
spawn the agent in. This gives flexibility to have specific OS's
(e.g. Alpine, Debian, Ubuntu), as well as some core tooling already
installed for the project, what will increase development speed,
because the agent won't need to install new packages.

## Rover provided agent images

### Development images

The code at the `main` branch points to
`ghcr.io/endorhq/rover/agent-dev:latest`. Automation builds and pushes
to this image when a new commit is pushed to the `main` branch.

### Tagged images

Whenever we create a new tag in Rover, a new image will be pushed with
that tag name at: `ghcr.io/endorhq/rover/agent:<tag>`.

## Using your own agent image

### Minimum image requirements

The minimum requirements for the image follows:

#### Node

Regardless of the base image you use, Node 24 is a prerequisite, as
[`rover-agent`](https://github.com/endorhq/rover/tree/main/packages/agent)
is a Node application.

#### Package Manager MCP

The [package-manager
MCP](https://github.com/endorhq/package-manager-mcp) is a static
binary that allows the configured agent to search and install packages
in the container.

It is expected that a binary named `package-manager-mcp-server` exists
in the `$PATH`. It will be configured during the agent set up phase.

You can find the static binaries in the [Releases
list](https://github.com/endorhq/package-manager-mcp/releases).

#### Reserved directories

Reserved directories may or may not exist in the container
image. However, their original contents won't be available during
Agent execution, as host paths will be mounted in these directories
automatically by Rover.

- `/workspace`: mountpoint used for the user project.

- `/output`: mountpoint used by Rover to follow the task progress.

#### Sudo

`sudo` needs to be available. The Rover agent CLI goes through two
main steps:

1. Setting up the environment and installing system dependencies
2. Running the chosen agent

Ideally, there should be two `sudo` profiles:

- `/etc/sudoers.d/1-agent-setup`
- `/etc/sudoers.d/2-agent-cleanup`

The contents of this files will depend on the default groups present
in the base image to be configured for Rover. However, a good rule of
thumb is to take `/etc/group` from the base and configure both
accordingly, adding an extra group `agent` that will be created
automatically by Rover if necessary.

Rover will remove `/etc/sudoers.d/1-agent-setup` before handing
control to the agent. From that point on, the
`/etc/sudoers.d/2-agent-cleanup` will determine what the agent is able
to do with `sudo`: it is highly recommended to reduce the list of
commands that could be executed with root permissions without
password.

An example for `node:24-alpine` follows:

<details>

<summary>/etc/sudoers.d/1-agent-setup</summary>

# Rover agent group; if there is no matching gid within the container

# with the host gid, the `agent` group will be used.

%agent ALL=(ALL) NOPASSWD: ALL

# Original image group list at /etc/group. If the host user gid

# matches with any of them, it will be able to use `sudo` normally

# within the container.

%root ALL=(ALL) NOPASSWD: ALL
%bin ALL=(ALL) NOPASSWD: ALL
%daemon ALL=(ALL) NOPASSWD: ALL
%sys ALL=(ALL) NOPASSWD: ALL
%adm ALL=(ALL) NOPASSWD: ALL
%tty ALL=(ALL) NOPASSWD: ALL
%disk ALL=(ALL) NOPASSWD: ALL
%lp ALL=(ALL) NOPASSWD: ALL
%kmem ALL=(ALL) NOPASSWD: ALL
%wheel ALL=(ALL) NOPASSWD: ALL
%floppy ALL=(ALL) NOPASSWD: ALL
%mail ALL=(ALL) NOPASSWD: ALL
%news ALL=(ALL) NOPASSWD: ALL
%uucp ALL=(ALL) NOPASSWD: ALL
%cron ALL=(ALL) NOPASSWD: ALL
%audio ALL=(ALL) NOPASSWD: ALL
%cdrom ALL=(ALL) NOPASSWD: ALL
%dialout ALL=(ALL) NOPASSWD: ALL
%ftp ALL=(ALL) NOPASSWD: ALL
%sshd ALL=(ALL) NOPASSWD: ALL
%input ALL=(ALL) NOPASSWD: ALL
%tape ALL=(ALL) NOPASSWD: ALL
%video ALL=(ALL) NOPASSWD: ALL
%netdev ALL=(ALL) NOPASSWD: ALL
%kvm ALL=(ALL) NOPASSWD: ALL
%games ALL=(ALL) NOPASSWD: ALL
%shadow ALL=(ALL) NOPASSWD: ALL
%www-data ALL=(ALL) NOPASSWD: ALL
%users ALL=(ALL) NOPASSWD: ALL
%ntp ALL=(ALL) NOPASSWD: ALL
%abuild ALL=(ALL) NOPASSWD: ALL
%utmp ALL=(ALL) NOPASSWD: ALL
%ping ALL=(ALL) NOPASSWD: ALL
%nogroup ALL=(ALL) NOPASSWD: ALL
%nobody ALL=(ALL) NOPASSWD: ALL
%node ALL=(ALL) NOPASSWD: ALL
%nix ALL=(ALL) NOPASSWD: ALL
%nixbld ALL=(ALL) NOPASSWD: ALL

</details>

<details>

<summary>/etc/sudoers.d/2-agent-cleanup</summary>

# Rover agent group; if there is no matching gid within the container

# with the host gid, the `agent` group will be used.

%agent ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee

# Original image group list at /etc/group. If the host user gid

# matches with any of them, it will be able to use `sudo` normally

# within the container.

%root ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%bin ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%daemon ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sys ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%adm ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%tty ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%disk ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%lp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%kmem ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%wheel ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%floppy ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%mail ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%news ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%uucp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%cron ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%audio ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%cdrom ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%dialout ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ftp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sshd ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%input ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%tape ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%video ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%netdev ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%kvm ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%games ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%shadow ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%www-data ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%users ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ntp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%abuild ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%utmp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ping ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nogroup ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nobody ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%node ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nix ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nixbld ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/teepp

</details>
