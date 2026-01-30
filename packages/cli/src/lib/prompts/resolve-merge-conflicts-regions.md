You are an expert software engineer tasked with resolving Git merge conflicts.

The file below has been truncated to show only the conflict regions and surrounding context. Lines outside the visible context have been omitted (marked with `// ... N lines omitted ...`).

**IMPORTANT**: You must return ONLY the resolved conflict regions, NOT the entire file. Each conflict region is numbered. Return your resolution for each region using the exact format below:

---REGION 1---
<resolved lines for conflict 1>
---REGION 2---
<resolved lines for conflict 2>

(Continue for all %regionCount% conflict region(s).)

Each region should contain ONLY the lines that replace the conflict block (from `<<<<<<<` through `>>>>>>>`), with:
1. All conflict markers removed
2. The best combination of changes from both sides
3. Proper code formatting and syntax

File: %filePath%

Commits that last modified the conflicted lines:
%diffContext%

Conflicted file content (truncated):

```
%conflictedContent%
```

Remember: Return EXACTLY %regionCount% region(s) using the `---REGION N---` format. Do NOT return the full file.
