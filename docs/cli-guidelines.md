# CLI Guidelines

The main user entrypoint in Rover is the CLI. It allow users to create and manage tasks. Most of the existing commands focuses on working with tasks and their lifecycle. Our CLI should provide relevant information to the user, guiding them to use coding agents, and giving visibility on current tasks.

## Principles

These principles are mandatory and affects to all CLI projects in this repository, including the `packages/cli` and `packages/agent` projects.

1. CLIs must be useful. Show always relevant and concise information
2. Output must be consistent in terms of naming, style, tone, and output
3. Keep users engaged. Stream information when possible and show a loader for long running tasks
4. Provide friendly questions and output, while looking proffesional

## Tone

TODO

## Arguments and options

TODO

## Patterns

Rules and examples for common patterns.

### Headers

The header is the section that appears right before any command output. Here, we have two types of headers:

- Splash: it shows the "ROVER" text with a gradient. It's only used to configure the Rover project (`rover init`).
- Regular: it shows the CLI name, version, and current context:

  ```
  Rover (v1.3.0) · /home/user/workspace/project
  ---------------------------------------------
  ```

### Title

Titles highlights a separate section in the CLI output. It uses a bold cyan text with a line break just before.

```

Title
```

To keep the output clear, we should reduce the number of sections in a single output. Be concise and clear.

### Lists

A list enumerate elements that are related. Here, we should distinguish between three different types of lists:

- Properties: a title + description set of related elements. Some examples are properties of the same object. In this case, we show the titles using a gray text, values in white, and prefix the list items with the `·` symbol:

  ```
  · ID: 76
  · Title: Update the AGENTS.md file.
  · Description: |
    This is a longer value that might spawn multiple lines.
    We show it using the | decorator on the property name.
  ```

- Independent elements: a list of elements that represents independent entities. For example, a list of files. Here, we use the listing `├──` and `└──` symbols.

  ```
  Iteration Files 1/1
  ├── changes.md
  ├── context.md
  ├── plan.md
  └── summary.md
  ```

- Process: a list of steps that are completed sequentially and have metatada associated to them. For example, the process of creating a task (create branch + worktree, run container, etc.). In this case, we add a title section and a border under it. Then, we show the steps as they are processed following a log format:

  ```
  Run the task in the background
  ------------------------------
  ● 12:30 | Created the rover/task-123jhksdna branch and worktree
  ○ 12:31 | Starting the rover-task-44-1 container
  ```

  The color of the circle depends on the step status. If it's ongoing, use yellow. If it's done, green for success and red for failure.

### File content

For file content, we will show the content as a box. The title will be filename. We will use the [`boxen` library](https://github.com/sindresorhus/boxen) for this.

```
┌ context.md ─────┐
│ foo bar foo bar │
└─────────────────┘
```

## Avoid always

These are mandatory rules. Not following them will cause a really bad UX for our users.

- Do not set the color for regular text. Avoid using `color.white` helpers as they will look bad on light terminals.
