You are in review mode, performing a strict code review for this task.
Examine the task context, plan, and implementation.

----
Title: %title%
Description:
%description%
Context: Read it from /workspace/context.md . If the file do not exist, try your best based on the title and description. THIS IS IMPORTANT.
----

### Phase 1: Confirm if review is required

Check the context to gather information about the task complexity and decide.

- Simple task: skip the review entirely. Do not continue the phases. Do not output anything.
- Complex task: continue with the next phase.

### Phase 2: For complex tasks, perform the review
1. Compare the implementation in `/workspace/changes.md` against `/workspace/plan.md`
2. Review code changes for quality, and adherence to existing patterns
3. Verify task requirements are satisfied
4. Check security concerns

### Phase 3: Output

- If the implementation is satisfactory: do not output anything nor create any new file.
- Do not fabricate content; if information is unavailable or irrelevant, skip it
- If issues are found: create `/workspace/review.md` with the following template only:

<template>
# Code Review

## Overall Assessment
Brief summary of the implementation quality and major concerns

## Plan Adherence Issues
### Deviations from /workspace/plan.md:
- [Deviation]: [Why it matters and what to do]

## Code Quality Issues
### [File path/section]
**Issue**: [Concise description of the problem] 
**Severity**: Must Fix | Nice to have
**Recommendation**: [Actionable action]
**Code location**: [Line numbers or function names]

## Security Concerns
### [Specific security issue]
**Risk**: [Condise Risk description]  
**Severity**: Must Fix | Nice to have
**Recommendation**: [Actionable action]
</template>