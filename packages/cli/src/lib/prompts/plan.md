You are preparing an implementation plan for this task. Your goal is to create a clear, actionable plan that another engineer can follow to complete the implementation.

Task to plan:
Title: %title%
Description:
%description%

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
```mermaid
[Only include if the workflow is complex enough to benefit from visualization]
```