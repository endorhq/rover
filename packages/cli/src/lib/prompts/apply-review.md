You are implementing fixes based on the code review feedback. Your goal is to address all the issues identified in /workspace/review.md and update the implementation accordingly.

Task being fixed:
Title: %title%
Description:
%description%

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