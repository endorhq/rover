You are implementing this task following the established plan. Your goal is to complete the implementation according to the plan specifications.

Task to implement:
Title: %title%
Description:
%description%

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

### `path/to/file.ts`
**Purpose**: [What this file does in the system]
**Changes made**:
- [Detailed description of each change]
- [Include line numbers and specific modifications]
- [Explain the reasoning behind each change]

## Files Added

### `path/to/new-file.ts`
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

### `src/commands/task.ts`
**Purpose**: Main task command implementation that handles user input and task creation
**Changes made**:
- Added --from-github option to Commander configuration (line 23)
- Added GitHub issue fetching logic in the main command handler (lines 45-67)
- Integrated fetchGitHubIssue function call with error handling
- Modified task description prompt to skip when GitHub data is available


## Files Added

### `src/utils/github.ts`
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