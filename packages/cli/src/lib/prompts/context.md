You are preparing a technical context for this task implementation:

Task title: %title%
Task description: %description%

Follow these steps to complete it. Do not move to the next phase until to complete the previous one.

1. Phase 1: Triage the task complexity.
    - Identify the task complexity by analyze the affected files and the complexity of the task. Categorize it on: 
        - Simple task: affects ≤1–2 files. No complex changes involved. The changes are straightforward and a plan might not be required.
        - Complex task: affects multiple files. It requires to introduce new libraries or create them. To properly implement them, it is recommended to first write a plan.
2. Phase 2: Adapt your analysis depth:
    - For simple tasks: fill only the "Task Complexity", "Relevant Code" and "Extra OS packages" sections. Skip all other sections
    - For complex tasks: complete all sections.

Follow these rules to complete the research:

- Use 1-line bullets wherever possible. Do not fabricate content; if information is unavailable or irrelevant, skip it
- Find the main file or files affected by these changes. Then, identify other secondary files. Focus mostly on main files and avoid a deep research in the secondary ones
- Follow the template strictly
- Just output the template. Skip any text before and after
- Use globs when a change affects multiple files

Then, write your structured analysis to `/workspace/context.md` following this template. This is mandatory.

<template>
# Context

## Task complexity
simple|complex

## Relevant code
- path/to/file:start-end: 1-line description (include line numbers only if code is accessible)

## Extra OS packages
Identify missing OS packages to accomplish this task and install them using the tools provided by the `package-manager` MCP. Return a list of new installed packages or "No additional packages required".

## Relevant knowledge
Skip this entire section and title for simple tasks

### Patterns
- pattern: brief description (only if non-standard)

### Dependencies
- library name: 1-line description about why this library is relevant

</template>

Examples:

**Simple task**

Title: Fix typo in error message
Description: In src/auth/login.ts, the login failure error message has a typo: “Invlaid credentials” should be “Invalid credentials.”

<good-example>
# Context

## Task complexity
simple

## Relevant code
- src/auth/login.ts:42-45: Error handling block with the incorrect error message

## New OS packages
No additional packages required
</good-example>

**Complex task**

Title: Add rate limiting to login endpoint
Description: Implement request rate limiting for the login endpoint using express-rate-limit with Redis as the store. Integrate it into the authentication middleware.

<good-example>
# Context

## Task complexity
complex

## Relevant code
- src/auth/login.ts:23-45: Login endpoint logic currently without rate limiting
- src/middleware/auth.ts:12-18: Middleware chain setup for authentication
- src/config/redis.ts:5-20: Redis client connection configuration

## New OS packages
No additional packages required

## Relevant knowledge

### Patterns
- Middleware pattern: Express request pipeline
- Token bucket: Common rate-limiting algorithm

### Dependencies
- express-rate-limit: Required for implementing rate limiting
- redis: Required for storing rate limit state
</good-example>