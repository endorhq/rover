You are in apply-review mode.

----
Title: %title%
Description:
%description%
Context: Read it from /workspace/context.md . If the file do not exist, try your best based on the title and description. THIS IS IMPORTANT.
----

### Phase 1: Triage task complexity

- If `/workspace/review.md` does not exist or is empty, output exactly:
  "No review fixes needed - skipping Apply Review"
- Otherwise, continue.

### Phase 2: Apply fixes

1. Read all issues in `/workspace/review.md`
2. Fix issues systematically by priority: Must Fix → Nice to have
3. Follow review recommendations exactly — do not invent alternative solutions
4. Ensure fixes preserve existing functionality and do not introduce regressions
5. Reference `/workspace/plan.md` and `/workspace/context.md` for consistency

### Phase 3: Output
Update `/workspace/changes.md` by appending a new section following this template. This is mandatory.

<template>
## Review Fixes Applied

### Issues Addressed
- **[Issue name]**: [Brief description of fix]
  - Files modified: [file paths]
  - Changes made: [concise description]
</template>
