# CLI Guidelines

The main user entrypoint in Rover is the CLI. It allows users to create and manage tasks. Most of the existing commands focuses on working with tasks and their lifecycle. Our CLI should provide relevant information to the user, guiding them to use coding agents, and giving visibility on current tasks.

## Principles

These principles are mandatory and affect all CLI projects in this repository, including the `packages/cli` and `packages/agent` projects.

1. CLIs must be useful. Show always relevant and concise information
2. Output must be consistent in terms of naming, style, tone, and output
3. Keep users engaged. Stream information when possible and show a loader for long running tasks
4. Provide friendly questions and output, while looking professional

## Tone

The CLI we design must help users to complete their tasks. Users must feel productive, and we should avoid any kind of frustration. For that, the CLI tone and style should follow these rules:

1. Use short and clear descriptions when they are required
2. Be concise
3. Naming must be consistent across commands, arguments, options, and output
4. Use a friendly tone
5. Prefer conversation over direct questions
6. Avoid overusing emojis. Use them just to highlight relevant information or personalize Rover

## Colors

- Default color (no color): regular text
- Cyan: titles
- Purple: main information. Just a single element per section
- Gray: properties, and less relevant information
- Green: successful responses
- Yellow: ongoing work and warning information
- Red: failed operations and errors

## Commands

To define commands, we clearly distinguish between two levels:

1. **Main commands**: they are part of the default Rover process: initialize Rover in a project, create a task, and merge it. They are located at top level and split into sections
2. **Subcommands**: offers extra functionality, like managing the configuration and workflows

The naming conventions for any command are:

- Main commands and subcommands must be short
- Main commands refer always to the concept of "task", which is the top resource
- Subcommands must be nouns that represent resources (config, workflows, etc.). Distinguish between singular and plural depending on the resource
- For main commands and subcommands, prefer to use verbs over nouns
- Commands must be consistent across resources. If we want to rename or delete a command, we should deprecate all at once
  - `new`
  - `list`
  - `inspect`
  - `delete`
  - `update`

### Exceptions

There are some inconsistencies we might change in the future. I will document them here for future reference:

- The `task` command is not consistent. It should be `new` or `create`

### Arguments and options

Arguments and options expand the configuration for each command. They should be clear, concise, and in-context. Some rules to follow:

- Use arguments for the main command input (`<task id>`)
- Use arguments always for mandatory fields (`<task id>`)
- Use optional arguments at the end for information that might be asked later or it's not required to run a certain command (`[task description]`)
- Use options for any input that change the default command behavior (`--yes`). Give a short option as well as a long one when possible (no clashes exist.)
- Use descriptive names for options and add an alternative shorter version (`--source-branch | -s`)
- Place global options at the CLI level (`--debug`)
- Use a consistent option and argument names across all commands (`task id`)

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

Titles highlights a separate section in the CLI output. It uses a bold cyan text with a line break right before.

```

Title
-----
```

To keep the output clear, we should reduce the number of sections in a single output. Be concise and clear.

### Lists

A list enumerates related elements. Here, we should distinguish between three different types of lists:

- Properties: a title + description set of related elements. Some examples are properties of the same object. In this case, we show the titles using a gray text, values in white, and prefix the list items with the `·` symbol:

  ```
  · ID: 76
  · Title: Update the AGENTS.md file.
  · Description: |
    This is a longer value that might spawn multiple lines.
    We show it using the | decorator on the property name.
  ```

- Independent elements: a list of elements that represent independent entities. For example, a list of files. Here, we use the listing `├──` and `└──` symbols.

  ```
  Iteration Files 1/1
  ├── changes.md
  ├── context.md
  ├── plan.md
  └── summary.md
  ```

- Process: a list of steps that are completed sequentially and have metadata associated to them. For example, the process of creating a task (create branch + worktree, run container, etc.). In this case, we add a title section and a border under it. Then, we show the steps as they are processed following a log format:

  ```
  Run the task in the background
  ------------------------------
  ● 12:30 | Created the rover/task-123jhksdna branch and worktree
  ○ 12:31 | Starting the rover-task-44-1 container
  ```

  The color of the circle depends on the step status. If it's ongoing, use cyan. If it's done, green for success and red for failure.

  Processes will be **located at the end of the command output when possible**.

### File content

For file content, we will show the content as a box. The title will be filename. We will use the [`boxen` library](https://github.com/sindresorhus/boxen) for this.

```
┌ context.md ─────┐
│ foo bar foo bar │
└─────────────────┘
```

### Tips

Tips help users to understand the next steps or related actions in the current context. To be helpful, we need to limit them as a long list will be ignored.

The conventions for tips are:

1. When there's a clear next step, just show one tip
2. Avoid showing more than two tips
3. Tip messages must be concise
4. If the alternative actions are not clearly relevant, skip the tips
5. Show tips always at the bottom
6. Use the following format for tips. Use cyan for the "Tip:" text and gray for the rest

```

Tip: run `rover logs 12` to check logs
```

## Avoid always

These are mandatory rules. Not following them will cause a really bad UX for our users.

- Do not set the color for regular text. Avoid using `color.white` helpers as they will look bad on light terminals.
- Do not overuse emojis
