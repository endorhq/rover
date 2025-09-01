You are preparing an implementation plan for this task:

---

Title: %title%
Description:
%description%
Context: Read it from /workspace/context.md . If the file do not exist, try your best based on the title and description. THIS IS IMPORTANT.

---

Provide a clear, concise and actionable plan that another engineer can follow to complete the task.

Follow these steps to complete it. Do not move to the next phase until to complete the previous one.

### Phase 1: Evaluate task requirements

- Read the provided context
- Identify the complexity of the given task. Check the context.
- Define a clear and concise objective for the plan
- Specify the scope, focusing on the task objective
- Identify files that will be affected by the changes
- Identify existing test files that should be updated

### Phase 2: Write a plan based on the task requirements.

Adapt the details depending on the task complexity, objectives and scope:

- Simple task: ≤3 steps max, short objective, scope limited to 1–3 files. Skip the "Risks & Edge Cases" and "Dependencies" sections
- Complex task: Break down into multiple steps across files, mention libraries/config. Complete all sections

### Phase 3: Output

- Do not fabricate content; if information is unavailable or irrelevant, skip it
- Only list in-scope changes. Do not mention out-of-scope items.
- Only add existing test files to the scope and implementation steps. Do not add any step or scope item to create new test suites unless the task description request it explicitly. This is VERY IMPORTANT
- Break down implementation into small, clear and concise steps. Do not overengineer, focus on the changes to complete the task and clear side effects.
- Follow the template strictly
- Just output the template. Skip any text before and after

Write your plan to `/workspace/plan.md` following this template. This is mandatory.

<template>
# Implementation Plan

## Objective

1–2 sentences describing the task objective

## Scope

- List of changes that are in the task scope (one line each)

## Implementation Steps

- [ ] One line each, start with a verb, always include filenames, keep concise and actionable.

## Risks & Edge Cases

- Potential pitfalls in 1 line each (skip if none)

## Dependencies

- Prerequisite libraries, configs, or tasks (skip if none)
  </template>
