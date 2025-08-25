# Create a GitHub pull request

Create a GitHub Pull Request based on the changes between the current branch and the `main` branch. Follow these rules to create the pull request content:

1. Use a clear and concise title that summarizes the most relevant change in the pull request. The title follows the conventional commit format we use in this project.

    <good-example>
    feat: add the new reset command to the CLI

    fix: manage invalid name error when creating a new task
    </good-example>
    <bad-example>
    Refactor the git commands into a separate library

    Fix an issue
    </bad-example>

2. The pull request body must be informative, clear, and concise. Use a neutral language that explain the changes so users can quickly identify the changes in the pull request.

3. Do not include any checklist at the end

4. Do not include any "Created by Claude" comment at the end

5. Use GitHub markdown format in the body. For example, use the code blocks to show pieces of code, inline code blocks to highlight methods in paragraphs and list items, mermaid diagrams for complex pull requests, and tables when required.

6. Follow this template:

    <template>
    Brief summary for the changes in the pull request. 2 paragraphs max.

    # Changes

    Enumerate the major and most important changes in the pull request. Keep the list clear, short and concise.

    # Notes

    An optional section to indicate any other relevant information, major architectural change, future work, other changes that were not part of the task by were implemented in this pull request. You can also include a mermaid diagram if the changes are complex and a diagram might help to understand them.
    </template>

    <good-example>
    Refactor the push command to use the centralized Git library, improving code maintainability and consistency across the CLI.

    ## Changes
    
    - Added `push()` method to the Git class with support for setting upstream branches
    - Added `remoteUrl()` method to retrieve git remote URLs
    - Added `uncommitedChanges()` method to get list of uncommitted files
    - Refactored push command to use the Git library instead of direct spawnSync calls Improved error handling with consistent GitError exceptions
    - Updated push command to use new exit utility functions (`exitWithError`, `exitWithSuccess`, `exitWithWarn`)

    ## Notes

    Temporarily removed the _Pull Request_ push feature to improve the overall process.
    </good-example>

    <good-example>
    Simplify the merge command by removing unused console messages that might confuse the user. Centralize all git operations in a git class for better maintainability.

    ## Changes
    - Removed interactive conflict resolution prompts and manual resolution flow
    - Added comprehensive merge-related methods including `mergeBranch()`, `getMergeConflicts()`, `abortMerge()`, and `continueMerge()`
    - Better merge conflict detection and reporting

    ## Notes
    The `merge` command flow is now simpler, so the user does not need to provide many input to complete it.

    Here you have a diagram with the new flow:

    ```mermaid
    flowchart TD
    Start([rover merge taskId]) --> ValidateTaskId{Valid Task ID?}
    ValidateTaskId -->|No| Error1[Error: Invalid task ID]
    ValidateTaskId -->|Yes| LoadTask
    
    LoadTask --> CheckCompleted{Task Completed?}
    CheckCompleted -->|No| Error3[Error: Task not completed]
    CheckCompleted -->|Yes| CheckUncommitted{Has Uncommitted<br/>Changes in Main?}
    
    CheckUncommitted -->|Yes| Error5[Error: Commit or stash changes first]
    CheckUncommitted -->|No| CheckChanges{Has Worktree Changes<br/>or Unmerged Commits?}
    
    CheckChanges -->|No| Success1[✓ No changes to merge]
    CheckChanges -->|Yes| ConfirmMerge{User Confirms<br/>Merge?}
    
    ConfirmMerge -->|No| Cancelled[Merge Cancelled]
    ConfirmMerge -->|Yes| AttemptMerge[Merge Task Branch]
    
    AttemptMerge --> MergeResult{Merge<br/>Successful?}
    
    MergeResult -->|Yes| Success2[✓ Task Merged Successfully]
    MergeResult -->|No| [Notify user about errors]
    ```
    </good-example>

    <bad-example>
    Improve the shell command output to consolidate it based on #47 . Add a new random ID to the generated container to avoid collisions.
    </bad-example>

    <bad-example>
    ## Summary

    Replaces the remaining `exec` invocations with `spawn` across the VS Code extension codebase for improved security and better argument handling.

    ## Changes

    - **packages/extension/src/extension.mts**: Replaced `exec` with `spawn` for git operations (status, remote get-url) and GitHub CLI commands
    - **packages/extension/src/rover/cli.ts**: Completely replaced `execAsync` with `spawn` for all Rover CLI interactions including:
    - Task listing, creation, inspection, and deletion
    - Branch pushing and merging
    - Task iteration and diff operations
    - Log streaming (with proper process handling)

    ## Benefits

    - **Security**: Eliminates shell injection vulnerabilities by using direct process spawning
    - **Reliability**: Better error handling and argument sanitization
    - **Consistency**: Aligns with the security improvements made in the main CLI codebase

    ## Test Plan

    - [x] Verified all existing VS Code extension functionality works with spawn
    - [x] Tested task creation, inspection, and management through the extension
    - [x] Confirmed git operations and GitHub CLI integrations work correctly

    🤖 Generated with [Claude Code](https://claude.ai/code)
    </bad-example>

7. Use the `gh` CLI to create the pull request