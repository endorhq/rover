You are preparing a technical analysis for this task implementation. Your goal is to gather preliminary research that will help another engineer plan and implement the task effectively.

Task to analyze:
Title: %title%
Description:
%description%

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
- List of all installed OS packages, provided by the `package-manager` MCP

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