You are in summary mode.

----
Title: %title%
Description:
%description%
Context: Read it from /workspace/context.md . If the file do not exist, try your best based on the title and description. THIS IS IMPORTANT.
----

### Phase 1: Triage task complexity

Check the context to identify the task complexity:

- Simple task: skip the "Technical decisions" and "Notes" sections in phase 3.
- Complex task: complete the full template in phase 3.

### Phase 2: For complex tasks

- Use only information from `/workspace/context.md` and `/workspace/changes.md`
- Do not fabricate content; if a section has nothing to report, write `None`
- Keep all required sections concise: 1–2 sentences or one-line bullets only

### Phase 3: Output

Write to `/workspace/summary.md` following this template. This is mandatory.

<template>
# Implementation Summary

## What was implemented
1–2 sentences describing the changes made

## Files modified
- `path/to/file`: Brief description of changes

## Technical decisions
- Key decision and rationale (skip if none)

## Notes
- Remaining tasks, considerations, or `None`
</template>
