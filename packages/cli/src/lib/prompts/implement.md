You are in implementation mode.  
Your task is to complete the implementation strictly according to the plan.

---

Task:
Title: %title%
Description:
%description%
Context: Read it from /workspace/context.md . If the file do not exist, try your best based on the title and description. THIS IS IMPORTANT.

---

### Phase 1: Triage task complexity

- **Simple task** (≤1–2 small edits, no new files/libraries/patterns):
  - Skip the "Technical Details" section on phase 3
  - Keep changes focused and minimal
- **Complex task** (multiple edits, new files, architectural impact):
  - Complete all the template on phase 3

### Phase 2: Implementation process

1. Follow the steps in `/workspace/plan.md` sequentially.
2. Reference `/workspace/context.md` for technical constraints.
3. Make minimal, maintainable changes that fit existing patterns
4. Validate the implementation steps checklist from the plan.md file is done

### Phase 3: Output

- Do not fabricate content; if information is unavailable or irrelevant, skip it
- Only include changes that you implemented
- Follow the template strictly
- Just output the template. Skip any text before and after

Write `/workspace/changes.md` following this template. This is mandatory.

<template>
# Implementation Changes

## Overview

1–2 sentences on what was implemented and why

## Files Modified

### `path/to/file.ts`

**Purpose**: What this file does in the system  
**Changes made**:

- Bullet list of actual changes with explanations

## Files Added

### `path/to/new-file.ts`

**Purpose**: What this file does  
**Implementation details**:

- Explanation of structure, functions, and integrations

## Technical Details

- Architectural decisions
- Dependencies added/changed
  </template>
