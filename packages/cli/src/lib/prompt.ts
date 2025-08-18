import { IterationConfig } from "./iteration.js";

/**
 * Interface representing a structured task with title and description.
 * This is the expected format for AI responses when expanding task descriptions
 * or iteration instructions.
 */
export interface IPromptTask {
    /** A concise, action-oriented title for the task (typically max 10-12 words) */
    title: string;
    /** Detailed description explaining what needs to be done, why, and relevant context */
    description: string;
}

/**
 * PromptBuilder provides a centralized system for generating prompts for different AI agents.
 * 
 * This library serves two main purposes:
 * 1. Generate structured prompts for task iteration workflows (context, plan, implement, etc.)
 * 2. Provide standardized prompts for common AI operations (task expansion, commit messages, etc.)
 * 
 * The prompts are designed to be agent-agnostic, with some customization possible through
 * the agent parameter. All prompt methods return strings that should be sent to AI agents
 * for processing. For JSON responses, use the parseJsonResponse utility to handle the results.
 * 
 * @example
 * ```typescript
 * const builder = new PromptBuilder('claude');
 * const taskPrompt = builder.expandTaskPrompt('add user authentication');
 * const result = await aiAgent.invoke(taskPrompt, true);
 * const parsed = parseJsonResponse<IPromptTask>(result);
 * ```
 */
export class PromptBuilder {
    /**
     * Create a new PromptBuilder instance
     * @param agent - The AI agent identifier (e.g., 'claude', 'gemini')
     */
    constructor(public agent: string = 'claude') { }

    /**
     * Generate and save all iteration workflow prompt files to the specified directory.
     * This method creates structured prompts for the complete task iteration lifecycle:
     * context analysis, planning, implementation, review, and summary.
     * 
     * @param iteration - Configuration object containing task details and iteration info
     * @param promptsDir - Directory path where prompt files will be saved
     * 
     * @example
     * ```typescript
     * const config = new IterationConfig(...);
     * const builder = new PromptBuilder();
     * builder.generatePromptFiles(config, '/workspace/prompts');
     * // Creates: context.txt, plan.txt, implement.txt, review.txt, apply_review.txt, summary.txt
     * ```
     */
    generatePromptFiles(iteration: IterationConfig, promptsDir: string): void {
        const { mkdirSync, writeFileSync } = require('node:fs');
        const { join } = require('node:path');

        // Ensure prompts directory exists
        mkdirSync(promptsDir, { recursive: true });

        // Generate each prompt and save to file
        const prompts = {
            'context.txt': this.context(iteration),
            'plan.txt': this.plan(iteration),
            'implement.txt': this.implement(iteration),
            'review.txt': this.review(iteration),
            'apply_review.txt': this.apply_review(iteration),
            'summary.txt': this.summary(iteration)
        };

        // Write each prompt to its respective file
        for (const [filename, content] of Object.entries(prompts)) {
            const filePath = join(promptsDir, filename);
            writeFileSync(filePath, content.trim(), 'utf8');
        }
    }

    /**
     * Provides a prompt that fetches the context to build a task.
     */
    context(iteration: IterationConfig): string {
        return `
You are preparing a technical analysis for this task implementation. Your goal is to gather preliminary research that will help another engineer plan and implement the task effectively.

Task to analyze:
Title: ${iteration.title}
Description:
${iteration.description}

Your analysis should:
1. Identify files that will be edited or affected by this task
2. Identify required domain knowledge including libraries and design patterns
3. Identify relevant code blocks and their relationships
4. Identify the project's linting, formatting, and testing conventions
5. Identify the mandatory OS package dependencies that this task needs in order to be implemented

Write your analysis to /workspace/context.md using this exact format:

# Context

## Affected files
- Path: Brief description of why this file is relevant to the task

## Relevant knowledge

### Libraries
- Library name, language

### Patterns
- Pattern name: Brief description (only needed for non-standard patterns)

## Relevant code
- path/to/file.ts:start_line-end_line: Description of this code block's purpose and relevance. You must include the relevant line numbers

## Component dependencies
- List any tasks or components this work depends on
- List any tasks that might be blocked by this work

## Review strategy
- Linting: Commands and configuration used in this project
- Formatting: Commands and tools (if none exist, note the language's standard formatter)
- Testing: Test framework and relevant test files

## Installed OS packages
- Refresh repositories before trying to install or update a package
- List of all installed OS packages, provided by the \`package-manager\` MCP

Example output:
# Context

## Affected files
- src/auth/login.ts: Contains authentication logic that needs rate limiting
- src/middleware/auth.ts: Middleware that will integrate the new rate limiter

## Relevant knowledge

### Libraries
- express-rate-limit, NodeJS
- redis, NodeJS

### Patterns
- Middleware pattern: Express middleware chain for request processing
- Token bucket: Rate limiting algorithm implementation

## Relevant code
- src/auth/login.ts:23-45: Current login endpoint without rate limiting
- src/middleware/auth.ts:12-18: Authentication middleware setup

## Dependencies
- Requires Redis connection to be configured
- No blocking dependencies identified

## Review strategy
- Linting: npm run lint (ESLint configuration)
- Formatting: npm run format (Prettier)
- Testing: npm test (Jest framework, see src/__tests__/)

## Installed OS packages
- alpine-baselayout-3.7.0-r0
- alpine-baselayout-data-3.7.0-r0
- alpine-keys-2.5-r0
- alpine-release-3.22.1-r0
- apk-tools-2.14.9-r2
- busybox-1.37.0-r18
- busybox-binsh-1.37.0-r18
- ca-certificates-bundle-20250619-r0
- libapk2-2.14.9-r2
- libcrypto3-3.5.1-r0
- libgcc-14.2.0-r6
- libssl3-3.5.1-r0
- libstdc++-14.2.0-r6
- musl-1.2.5-r10
- musl-utils-1.2.5-r10
- scanelf-1.3.8-r1
- ssl_client-1.37.0-r18
- zlib-1.3.1-r2
`
    }

    /**
     * Provides a prompt to define a plan for a task
     */
    plan(iteration: IterationConfig): string {
        return `
You are preparing an implementation plan for this task. Your goal is to create a clear, actionable plan that another engineer can follow to complete the implementation.

Task to plan:
Title: ${iteration.title}
Description:
${iteration.description}

Your plan should:
1. Define a clear objective for what will be accomplished
2. Specify the scope (what's included and excluded)
3. Break down implementation into minimal, focused steps
4. Provide validation criteria for completion

Reference the /workspace/context.md file for technical details. Write your plan to /workspace/plan.md using this exact format:

# Implementation Plan

## Objective
[One sentence describing what will be accomplished]

## Scope
### In scope:
- [Specific change or feature to implement]

### Out of scope:
- [What won't be changed or added]

## Implementation Steps
1. [First concrete action with specific file/component]
2. [Next action, keep minimal and focused]

## Validation Checklist
- [ ] All tests pass if available (use commands from /workspace/context.md)
- [ ] Linting passes (use commands from /workspace/context.md)
- [ ] Feature works as described in the task
- [ ] No regressions introduced

## Technical Diagram
\`\`\`mermaid
[Only include if the workflow is complex enough to benefit from visualization]
\`\`\`
`
    }

    /**
     * Provides a prompt to implement the plan
     */
    implement(iteration: IterationConfig): string {
        return `
You are implementing this task following the established plan. Your goal is to complete the implementation according to the plan specifications.

Task to implement:
Title: ${iteration.title}
Description:
${iteration.description}

Your implementation should:

1. Follow the steps outlined in /workspace/plan.md exactly
2. Reference /workspace/context.md for technical details and constraints
3. Write clean, maintainable code following existing patterns
4. Complete all validation checklist items from the plan if possible
5. Document all changes in /workspace/changes.md with detailed explanations

Start implementing step 1 of the plan and work through each step sequentially.

Implementation guidelines:

- Make minimal changes to achieve the objective
- Follow existing code conventions and patterns
- Add appropriate error handling where needed
- Update relevant tests if they exist
- Run linting and formatting commands as specified in /workspace/context.md

After completing the implementation, write detailed documentation to /workspace/changes.md using this exact format:

# Implementation Changes

## Overview
[Detailed description of what was implemented and why]

## Files Modified

### \`path/to/file.ts\`
**Purpose**: [What this file does in the system]
**Changes made**:
- [Detailed description of each change]
- [Include line numbers and specific modifications]
- [Explain the reasoning behind each change]

## Files Added

### \`path/to/new-file.ts\`
**Purpose**: [What this new file accomplishes]
**Implementation details**:
- [Detailed explanation of the file structure]
- [Key functions and their purposes]
- [Integration points with existing code]

## Technical Details
- [Important architectural decisions made]
- [Dependencies added or modified]
- [Performance considerations]
- [Security considerations if applicable]

## Testing

(If it applies)

- [Tests added or modified]
- [Test scenarios covered]
- [Manual testing performed]

## Validation Results

(If it applies)

- [ ] All tests pass: [details]
- [ ] Linting passes: [details]
- [ ] Feature works as described: [details/examples]
- [ ] No regressions: [verification method]

Example output:
# Implementation Changes

## Overview
Implemented GitHub issue fetching functionality for the task command. Added a new --from-github flag that accepts an issue number and automatically populates task details by fetching from GitHub API with fallback to gh CLI.

## Files Modified

### \`src/commands/task.ts\`
**Purpose**: Main task command implementation that handles user input and task creation
**Changes made**:
- Added --from-github option to Commander configuration (line 23)
- Added GitHub issue fetching logic in the main command handler (lines 45-67)
- Integrated fetchGitHubIssue function call with error handling
- Modified task description prompt to skip when GitHub data is available


## Files Added

### \`src/utils/github.ts\`
**Purpose**: Handles GitHub API integration and gh CLI fallback for issue fetching
**Implementation details**:
- fetchGitHubIssue function that tries API first, then gh CLI
- Error handling for private repos and authentication issues
- Type definitions for GitHub issue response
- Integration with existing TaskDescription interface

## Technical Details
- Uses node-fetch for GitHub API calls with proper error handling
- Implements graceful fallback to gh CLI when API fails
- Maintains existing task creation workflow while adding GitHub integration
- No breaking changes to existing functionality

## Testing
- Added unit tests for github.ts utility functions
- Added integration tests for task command with --from-github flag
- Manual testing with both public and private repositories
- Verified fallback behavior when gh CLI is not available

## Validation Results
- [✓] All tests pass: npm test shows 15/15 passing
- [✓] Linting passes: npm run lint shows no errors
- [✓] Feature works as described: Successfully fetched issues #123, #456 from test repo
- [✓] No regressions: Existing task creation workflow unchanged
`
    }

    /**
     * Provides a prompt to review task changes
     */
    review(iteration: IterationConfig): string {
        return `
You are acting as a senior code reviewer examining the implementation of this task. Your goal is to ensure the implementation follows the original plan, maintains code quality, and identifies any issues that need to be addressed.

Task reviewed:
Title: ${iteration.title}
Description:
${iteration.description}

Your review should:
1. Compare the implementation against the original /workspace/plan.md to identify deviations
2. Examine /workspace/changes.md to understand what was implemented
3. Review the actual code changes for quality, patterns, and potential issues
4. Check if all validation checklist items from the plan were completed
5. Look for security vulnerabilities, performance issues, or architectural concerns

Review criteria:
- **Plan adherence**: Does the implementation follow the planned steps exactly?
- **Code quality**: Are coding standards and existing patterns followed?
- **Completeness**: Are all requirements from the task description satisfied?
- **Testing**: Are appropriate tests added or updated?
- **Documentation**: Is the implementation properly documented?
- **Security**: Are there any security concerns introduced?
- **Performance**: Are there any performance implications?
- **Architecture**: Does the solution fit well with existing architecture?

**IMPORTANT**: Only create a /workspace/review.md file if you find issues that need to be addressed. If the implementation is satisfactory and follows the plan correctly, simply state "No review issues found - implementation approved" and do not create any file.

If issues are found, create /workspace/review.md with this exact format:

# Code Review

## Overall Assessment
[Brief summary of the implementation quality and major concerns]

## Plan Adherence Issues
### Deviations from /workspace/plan.md:
- [Specific deviation]: [Why this is problematic and what should be done]

### Missing requirements:
- [Missing feature/requirement]: [Impact and recommended action]

## Code Quality Issues
### [File path/section]
**Issue**: [Description of the problem]
**Severity**: High/Medium/Low
**Recommendation**: [Specific action to take]
**Code location**: [Line numbers or function names]

## Security Concerns
### [Specific security issue]
**Risk**: [Description of the security risk]
**Recommendation**: [How to address it]

## Performance Issues
### [Performance concern]
**Impact**: [Description of performance impact]
**Recommendation**: [Optimization suggestion]

## Testing Gaps
### [Missing test coverage]
**Gap**: [What is not tested]
**Recommendation**: [What tests to add]

## Action Items
### Must Fix (Blocking issues):
- [ ] [Critical issue that must be resolved]

### Should Fix (Important improvements):
- [ ] [Important issue that should be addressed]

### Could Fix (Nice to have):
- [ ] [Minor improvement suggestion]

Example output (only if issues are found):
# Code Review

## Overall Assessment
The GitHub integration feature is mostly well-implemented but has some security and error handling concerns that need to be addressed before merging.

## Plan Adherence Issues
### Missing requirements:
- Error handling for network failures: Plan specified graceful degradation but implementation doesn't handle timeout scenarios

## Code Quality Issues
### src/utils/github.ts
**Issue**: GitHub API token is hardcoded in the source
**Severity**: High
**Recommendation**: Move token to environment variable or configuration file
**Code location**: Line 15, fetchGitHubIssue function

### src/commands/task.ts
**Issue**: No input validation for issue number parameter
**Severity**: Medium
**Recommendation**: Add validation to ensure issue number is a positive integer
**Code location**: Line 52, --from-github option handler

## Security Concerns
### Hardcoded API credentials
**Risk**: GitHub token exposed in source code could lead to unauthorized API access
**Recommendation**: Use environment variables and add token to .gitignore template

## Action Items
### Must Fix (Blocking issues):
- [ ] Remove hardcoded GitHub token and use environment variable
- [ ] Add input validation for issue number parameter

### Should Fix (Important improvements):
- [ ] Add timeout handling for API calls
- [ ] Add unit tests for error scenarios

Begin your review by examining /workspace/plan.md, /workspace/changes.md, and the actual code changes.
`
    }

    /**
     * Provides a prompt to apply review feedback and fix identified issues
     */
    apply_review(iteration: IterationConfig): string {
        return `
You are implementing fixes based on the code review feedback. Your goal is to address all the issues identified in /workspace/review.md and update the implementation accordingly.

Task being fixed:
Title: ${iteration.title}
Description:
${iteration.description}

Your implementation should:
1. Read and understand all issues listed in /workspace/review.md
2. Address each action item systematically, starting with "Must Fix" items
3. Apply the recommended changes to the codebase
4. Ensure fixes maintain existing functionality and don't introduce new issues
5. Update /workspace/changes.md to document the review fixes applied

Implementation guidelines:
- Follow the specific recommendations provided in the review
- Maintain code quality and existing patterns while fixing issues
- Test your fixes to ensure they work correctly
- Prioritize fixes by severity: Must Fix → Should Fix → Could Fix
- Reference the original /workspace/plan.md and /workspace/context.md for architectural guidance

After applying all fixes, update the /workspace/changes.md file by adding a new section at the end:

## Review Fixes Applied

### Issues Addressed
- **[Issue category]**: [Brief description of what was fixed]
  - Files modified: [list of files]
  - Changes made: [specific changes applied]

### Validation
- [ ] All "Must Fix" items resolved
- [ ] All "Should Fix" items resolved
- [ ] Tests still pass after fixes
- [ ] No new issues introduced

Example addition to /workspace/changes.md:
## Review Fixes Applied

### Issues Addressed
- **Security**: Removed hardcoded GitHub API token
  - Files modified: src/utils/github.ts, .env.example
  - Changes made: Moved token to environment variable, added .env.example with GITHUB_TOKEN placeholder

- **Input Validation**: Added validation for issue number parameter
  - Files modified: src/commands/task.ts
  - Changes made: Added isNaN check and positive integer validation for --from-github parameter

- **Error Handling**: Added timeout handling for API calls
  - Files modified: src/utils/github.ts
  - Changes made: Added 5-second timeout to fetch calls with proper error messages

### Validation
- [✓] All "Must Fix" items resolved
- [✓] All "Should Fix" items resolved
- [✓] Tests still pass after fixes
- [✓] No new issues introduced

Start by examining /workspace/review.md to understand all the issues that need to be addressed, then work through them systematically.
`
    }

    /**
     * Provides a prompt to elaborate a summary
     */
    summary(iteration: IterationConfig): string {
        return `
You are creating a summary of the implemented changes for this task. Your goal is to document what was accomplished and provide key information for future reference.

Check the /workspace/context.md and /workspace/changes.md file to gather information.

Task completed:
Title: ${iteration.title}
Description:
${iteration.description}

Your summary should:
1. Describe what was implemented in 1-2 sentences
2. List the key files that were modified
3. Note any important technical decisions made
4. Highlight any remaining tasks or considerations

Write your summary to /workspace/summary.md using this exact format:

# Implementation Summary

## What was implemented
[Brief description of the changes made]

## Files modified
- \`path/to/file.ts\`: Description of changes
- \`path/to/another.ts\`: Description of changes

## Technical decisions
- [Key decision made and rationale]

## Notes
- [Any important considerations or remaining tasks]

Example output:
# Implementation Summary

## What was implemented
Added rate limiting to the login endpoint using express-rate-limit middleware with Redis storage.

## Files modified
- \`src/auth/login.ts\`: Added rate limiting middleware to login route
- \`src/middleware/rate-limit.ts\`: Created new rate limiting configuration
- \`package.json\`: Added express-rate-limit and redis dependencies

## Technical decisions
- Used Redis for distributed rate limiting to support multiple server instances
- Set limit to 5 attempts per 15 minutes based on security requirements

## Notes
- Tests updated to verify rate limiting behavior
- Documentation updated in auth section
`
    }

    /**
     * Generate a prompt for expanding a brief task description into a structured task
     * with title and description. This method returns a prompt string that should be
     * sent to an AI agent for processing.
     * 
     * @param briefDescription - A brief description of the task to be expanded
     * @returns A formatted prompt string for AI processing
     * 
     * @example
     * const builder = new PromptBuilder('claude');
     * const prompt = builder.expandTaskPrompt('add dark mode');
     * // Use with AI agent: const result = await aiAgent.invoke(prompt, true);
     * // Then parse: const parsed = parseJsonResponse<IPromptTask>(result);
     */
    expandTaskPrompt(briefDescription: string): string {
        return `Given this brief task description and project context, create a clear, actionable task title and expanded description.

    Brief Description: ${briefDescription}

    Respond ONLY with valid JSON in this exact format:
    {
    "title": "Concise, action-oriented title (max 10 words)",
    "description": "Detailed description explaining what needs to be done, why, and any relevant context. Include specific steps if applicable. (2-4 sentences)"
    }

    Examples:
    - Brief: "add dark mode"
    Response: {"title": "Implement dark mode toggle", "description": "Add a dark mode toggle to the application's settings page. This should include creating a theme context provider, updating all components to use theme-aware styling, and persisting the user's preference in local storage. Consider accessibility requirements and ensure proper color contrast ratios."}

    - Brief: "fix login bug"
    Response: {"title": "Fix authentication error on login", "description": "Investigate and resolve the bug causing users to receive authentication errors during login. Check the JWT token validation, ensure proper error handling in the auth middleware, and verify the connection to the authentication service. Test with multiple user accounts to ensure the fix works universally."}`;
    }

    /**
     * Generate a prompt for expanding iteration instructions based on previous work context.
     * This method helps create focused iteration tasks that build upon previous implementations.
     * 
     * @param instructions - New user instructions for this iteration
     * @param previousPlan - Optional previous plan from earlier iterations
     * @param previousChanges - Optional description of changes made in previous iterations
     * @returns A formatted prompt string for AI processing that incorporates context
     * 
     * @example
     * const builder = new PromptBuilder('gemini');
     * const prompt = builder.expandIterationInstructionsPrompt(
     *   'add error handling',
     *   'Previous plan: Implement user login',
     *   'Previous changes: Added basic login form'
     * );
     */
    expandIterationInstructionsPrompt(
        instructions: string,
        previousPlan?: string,
        previousChanges?: string
    ): string {
        let contextSection = '';

        if (previousPlan || previousChanges) {
            contextSection += `\nPrevious iteration context:\n`;

            if (previousPlan) {
                contextSection += `\nPrevious Plan:\n${previousPlan}\n`;
            }

            if (previousChanges) {
                contextSection += `\nPrevious Changes Made:\n${previousChanges}\n`;
            }
        }

        return `You are helping iterate on a software development task. Based on new user instructions and previous iteration context, create a focused title and detailed description for this specific iteration.

    ${contextSection}

    New user instructions for this iteration:
    ${instructions}

    Create a clear, action-oriented title and comprehensive description that:
    1. Incorporates the new user instructions
    2. Builds upon the previous work (if any)
    3. Focuses on what needs to be accomplished in this specific iteration
    4. Is specific and actionable

    Respond ONLY with valid JSON in this exact format:
    {
    "title": "Iteration-specific title focusing on the new requirements (max 12 words)",
    "description": "Detailed description that explains what needs to be done in this iteration, building on previous work. Include specific steps, requirements, and context from previous iterations. (3-5 sentences)"
    }

    Examples:
    - Instructions: "add error handling to the login form"
    Previous: User login form was implemented
    Response: {"title": "Add comprehensive error handling to login form", "description": "Enhance the existing login form by implementing comprehensive error handling for various failure scenarios. Add validation for network errors, authentication failures, and form validation errors. Display user-friendly error messages and ensure proper error state management. This builds on the previously implemented basic login form functionality."}

    - Instructions: "improve the performance of the search feature"
    Previous: Search functionality was added
    Response: {"title": "Optimize search performance and add caching", "description": "Improve the performance of the existing search feature by implementing result caching, debounced input handling, and optimized database queries. Add loading states and pagination to handle large result sets efficiently. This enhancement builds on the previously implemented basic search functionality to provide a better user experience."}`;
    }

    /**
     * Generate a prompt for creating git commit messages based on task information
     * and recent commit history. The generated message will follow conventional
     * commit formats and match the project's commit style.
     * 
     * @param taskTitle - The title of the completed task
     * @param taskDescription - Detailed description of the task
     * @param recentCommits - Array of recent commit messages for style consistency
     * @param summaries - Array of iteration summaries describing work completed
     * @returns A formatted prompt string for generating commit messages
     * 
     * @example
     * const builder = new PromptBuilder();
     * const prompt = builder.generateCommitMessagePrompt(
     *   'Add user authentication',
     *   'Implement login and signup functionality',
     *   ['feat: add user profile page', 'fix: resolve validation bug'],
     *   ['Iteration 1: Basic auth setup']
     * );
     */
    generateCommitMessagePrompt(
        taskTitle: string,
        taskDescription: string,
        recentCommits: string[],
        summaries: string[]
    ): string {
        let prompt = `You are a git commit message generator. Generate a concise, clear commit message for the following task completion.
        
        Task Title: ${taskTitle}
        Task Description: ${taskDescription}
        
        `;

        if (recentCommits.length > 0) {
            prompt += `Recent commit messages for context (to match style):
        ${recentCommits.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}
        
        `;
        }

        if (summaries.length > 0) {
            prompt += `Work completed across iterations:
        ${summaries.join('\n')}
        
        `;
        }

        prompt += `Generate a commit message that:
        1. Follows conventional commit format if the recent commits do (feat:, fix:, chore:, etc.)
        2. Is concise but descriptive (under 72 characters for the first line)
        3. Captures the essence of what was accomplished
        4. Matches the style/tone of recent commits
        
        Return ONLY the commit message text, nothing else.`;

        return prompt;
    }

    /**
     * Generate a prompt for AI-powered merge conflict resolution. This creates
     * detailed instructions for resolving Git merge conflicts by analyzing
     * conflict markers and recent commit context.
     * 
     * @param filePath - Path to the file containing merge conflicts
     * @param diffContext - Recent commit history or diff context for better understanding
     * @param conflictedContent - The full content of the file with conflict markers
     * @returns A formatted prompt string for resolving merge conflicts
     * 
     * @example
     * const builder = new PromptBuilder();
     * const prompt = builder.resolveMergeConflictsPrompt(
     *   'src/components/Header.tsx',
     *   'Recent commits: feat: update header, fix: resolve styling',
     *   '<<<<<<< HEAD\nconst title = "Old Title"\n=======\nconst title = "New Title"\n>>>>>>> feature-branch'
     * );
     */
    resolveMergeConflictsPrompt(
        filePath: string,
        diffContext: string,
        conflictedContent: string
    ): string {
        return `You are an expert software engineer tasked with resolving Git merge conflicts. 
                
                Analyze the following conflicted file and resolve the merge conflicts by choosing the best combination of changes from both sides or creating a solution that integrates both changes appropriately.

                File: ${filePath}

                Recent commit history for context:
                ${diffContext}

                Conflicted file content:
                \`\`\`
                ${conflictedContent}
                \`\`\`

                Please provide the resolved file content with:
                1. All conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch) removed
                2. The best combination of changes from both sides
                3. Proper code formatting and syntax
                4. Logical integration of conflicting changes when possible

                Respond with ONLY the resolved file content, no explanations or markdown formatting.`;
    }
}
