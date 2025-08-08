# VSCode Extension for Rover CLI: Planning Document

This document outlines the plan for creating a Visual Studio Code extension that provides a graphical interface for the Rover CLI tool.

## 1. Overview

The goal is to create a VSCode extension that enhances the developer experience of using Rover. The extension will provide a UI for managing and interacting with Rover tasks directly within the editor, reducing the need to switch to a terminal for common operations.

### Core Features:
- **Task Explorer:** A dedicated view in the VSCode Activity Bar to list all Rover tasks, showing their status and key information.
- **Task Interaction:** Contextual commands to create, inspect, start, stop, and delete tasks.
- **Log Viewing:** A way to stream logs for running tasks directly in a VSCode output channel or terminal.
- **Diff Viewing:** Integration with VSCode's diff viewer to show changes made in a task's worktree.

## 2. Project Scaffolding & Setup

The extension will be built using TypeScript, leveraging the standard VSCode extension development tools.

- **Generator:** Use `npx --package yo --package generator-code -- yo code` (Yeoman VSCode Extension Generator) to create a new TypeScript project.
- **Dependencies:**
  - `vscode`: The core VSCode API.
  - No other external dependencies are required initially, as the extension will primarily act as a wrapper around the `rover` CLI executable.
- **Project Structure:**
  ```
  extension/
  ├── .vscode/
  │   ├── launch.json
  │   └── tasks.json
  ├── src/
  │   ├── extension.ts         // Main activation file
  │   ├── rover/
  │   │   ├── cli.ts           // Wrapper for executing rover CLI commands
  │   │   └── types.ts         // TypeScript types for tasks, etc.
  │   └── providers/
  │       ├── TaskTreeProvider.ts // Logic for the Task Explorer Tree View
  │       └── TaskItem.ts      // Represents a single item in the Tree View
  ├── package.json
  └── tsconfig.json
  ```

## 3. Architecture

The extension's architecture is designed to separate concerns between the VSCode UI components and the underlying CLI interaction logic.

### `extension.ts` (Entry Point)
- **Activation:** The `activate` function will be the entry point.
- **Responsibilities:**
  - Register all commands defined in `package.json`.
  - Initialize and register the `TaskTreeProvider` to create the Task Explorer view.
  - Set up any event listeners (e.g., for configuration changes).

### `rover/cli.ts` (CLI Wrapper)
- **Purpose:** This module will be the sole interface for interacting with the `rover` executable. It abstracts the details of command execution and output parsing.
- **Key Functions:**
  - `getTasks(): Promise<RoverTask[]>`: Executes `rover list --json` and parses the output.
  - `createTask(description: string): Promise<void>`: Executes `rover task "..."`.
  - `inspectTask(taskId: string): Promise<TaskDetails>`: Executes `rover inspect <id> --json`.
  - `deleteTask(taskId: string): Promise<void>`: Executes `rover delete <id> --force`.
  - `startShell(taskId: string): void`: Executes `rover shell <id>` in a new VSCode terminal.
- **Implementation:** Uses Node.js's `child_process.exec` or `child_process.spawn` to run Rover commands. It will handle stdout, stderr, and exit codes.

### `providers/TaskTreeProvider.ts` (Tree Data Provider)
- **Purpose:** Implements the `vscode.TreeDataProvider` interface to populate the Task Explorer view.
- **Responsibilities:**
  - `getChildren()`: Fetches the list of tasks using the `rover/cli.ts` wrapper and maps them to `TaskItem` instances.
  - `getTreeItem()`: Returns the `TaskItem` for a given element.
  - **Refresh Mechanism:** Implements an `onDidChangeTreeData` event emitter to allow the view to be refreshed programmatically (e.g., after a task is created or deleted).

### `providers/TaskItem.ts`
- **Purpose:** Represents a single task in the Tree View.
- **Implementation:** Extends `vscode.TreeItem`.
- **Properties:**
  - `label`: The task title.
  - `description`: The task status (e.g., "COMPLETED", "IN_PROGRESS").
  - `id`: The task ID.
  - `iconPath`: An icon representing the task's status (e.g., a play icon for "IN_PROGRESS", a checkmark for "COMPLETED").
  - `contextValue`: A string that controls which commands are shown in the context menu (e.g., `task-running`, `task-new`).

## 4. Detailed Task Breakdown

Here is a list of tasks to be completed to build the extension.

---

### **Task 1: Initial Project Setup**
- **Title:** Scaffold VSCode Extension Project
- **Description:** Use the official Yeoman generator (`npx --package yo --package generator-code -- yo code`) to create a new TypeScript-based VSCode extension project. Configure the basic `package.json` and `tsconfig.json` files. The extension will created in a new `extension` folder in this repository.
- **Completion Criteria:**
  - A new directory `extension` is created within the `rover` repository.
  - The project can be opened in VSCode and launched in the Extension Development Host (`F5`).
  - The default "Hello World" command provided by the template runs successfully.

### **Task 2: Enhance Rover CLI for JSON Output**
- **Title:** Add `--json` flag to Rover commands
- **Description:** To ensure reliable parsing, modify the Rover CLI to support a `--json` flag for commands that output data, such as `list` and `inspect`. This avoids brittle screen scraping of human-readable tables.
- **Completion Criteria:**
  - `rover list --json` outputs a valid JSON array of task objects.
  - `rover inspect <id> --json` outputs a valid JSON object with detailed task information.
  - Existing human-readable output is maintained when the `--json` flag is not present.

### **Task 3: Implement the CLI Wrapper Service**
- **Title:** Create the Rover CLI Wrapper
- **Description:** Implement the `src/rover/cli.ts` module. This service will be responsible for executing `rover` commands and parsing their JSON output.
- **Completion Criteria:**
  - A `cli.ts` file is created.
  - It contains functions for `getTasks` and `inspectTask` that call the `rover` executable with the `--json` flag.
  - Functions correctly parse the JSON output and return it as strongly-typed TypeScript objects.
  - Error handling is implemented for cases where the CLI command fails.

### **Task 4: Create the Rover Task Explorer View**
- **Title:** Implement the Task Explorer Tree View
- **Description:** Create the UI for the extension, including an Activity Bar icon and a Tree View that lists tasks.
- **Completion Criteria:**
  - A "Rover" icon is added to the VSCode Activity Bar via `package.json`.
  - A "Tasks" Tree View is defined and registered under the Rover activity.
  - The `TaskTreeProvider.ts` and `TaskItem.ts` classes are created.
  - The Tree View calls the `cli.getTasks()` function and displays the list of Rover tasks.
  - Each task item displays an icon corresponding to its status.
  - A "Refresh" button is added to the view's title bar.

### **Task 5: Implement Core Task Commands**
- **Title:** Implement Create, Inspect, and Delete Task Commands
- **Description:** Implement the core commands for managing tasks. These commands will be accessible via the command palette and context menus in the Task Explorer.
- **Completion Criteria:**
  - **Create Task:**
    - A `rover.createTask` command is registered.
    - It prompts the user for a task description using `vscode.window.showInputBox`.
    - It calls `cli.createTask()` and refreshes the Task Explorer upon completion.
  - **Inspect Task:**
    - A `rover.inspectTask` command is added to the task item's context menu.
    - It calls `cli.inspectTask()` and displays the returned JSON details in a new, read-only editor tab.
  - **Delete Task:**
    - A `rover.deleteTask` command is added to the task item's context menu.
    - It shows a confirmation dialog using `vscode.window.showWarningMessage`.
    - It calls `cli.deleteTask()` and refreshes the Task Explorer.

### **Task 6: Implement Interactive Commands**
- **Title:** Implement Shell and Logs Commands
- **Description:** Add commands to open an interactive shell and view logs for a task.
- **Completion Criteria:**
  - **Shell:**
    - A `rover.shell` command is added to the context menu for active tasks.
    - It opens a new VSCode integrated terminal.
    - It executes `rover shell <taskId>` in the new terminal, handing control over to the user.
  - **Logs:**
    - A `rover.logs` command is added to the context menu for active tasks.
    - It executes `rover logs <taskId> --follow` in a new VSCode "Output" channel named "Rover Logs: <taskId>".

### **Task 7: Implement Diff and Merge Commands**
- **Title:** Implement Diff and Merge functionality
- **Description:** Integrate Rover's git capabilities with VSCode's UI.
- **Completion Criteria:**
  - **Diff:**
    - A `rover.diff` command is added to the task item's context menu.
    - It executes `rover diff <taskId> --only-files` to get a list of changed files.
    - For each changed file, it uses the `vscode.diff` command to open VSCode's native diff viewer, comparing the file in the worktree with the version in the main branch.
  - **Merge:**
    - A `rover.merge` command is added to the context menu for completed tasks.
    - It prompts for confirmation and then executes `rover merge <taskId> --force`.
    - It shows the output of the merge command in an output channel.

### **Task 8: Polishing and Error Handling**
- **Title:** Refine UX and Improve Error Handling
- **Description:** Add final touches to the extension, including better status reporting, icons, and robust error handling.
- **Completion Criteria:**
  - All commands provide clear feedback via `vscode.window.showInformationMessage` or `vscode.window.showErrorMessage`.
  - The extension gracefully handles cases where the `rover` CLI is not installed or not in the system's PATH.
  - Icons used in the Tree View are clear and consistent.
  - The `package.json` file is fully populated with publisher info, categories, and a descriptive README.
