# @endorhq/agent

The Rover Agent package is a library and binary to process, build and run agent workflow definitions in Rover. An _agent workflow_ is a definition of an agentic process to complete a specific task. It contains a set of inputs, outputs and steps.

For example, a common agent workflow is a software engineer (SWE) that takes a task description and implements changes in the code. It requires going through a set of steps like getting context, planning, implementing, and summarizing.

## Installation

```bash
npm install @endorhq/agent
```

## Example

Here's a complete example of a code review workflow:

```yaml
# code-reviewer.yml
version: '1.0'
name: 'code-reviewer'
description: 'Reviews code and provides feedback on quality and best practices'

inputs:
  - name: repository_url
    description: 'The GitHub repository to review'
    type: string
    required: true

  - name: file_types
    description: 'File extensions to include in review'
    type: string
    default: '.py,.js,.ts'
    required: false

outputs:
  - name: review_report
    description: 'Markdown file with the complete review'
    type: file
  - name: issues_count
    description: 'Number of issues found'
    type: string

defaults:
  tool: claude
  model: claude-3-sonnet

config:
  timeout: 3600
  continueOnError: false

steps:
  - id: analyze_structure
    type: agent
    name: 'Analyze Repository Structure'
    prompt: |
      Analyze the repository at {{inputs.repository_url}}.

      List all files with extensions: {{inputs.file_types}}

      Provide:
      1. Project structure overview
      2. Main components identified
      3. List of files to review
    outputs:
      - name: file_list
        description: 'List of files to review'
        type: string
      - name: project_overview
        description: 'Summary of the project structure'
        type: string

  - id: review_files
    type: agent
    name: 'Review Code Files'
    tool: gemini # Override default tool for this step
    model: gemini-pro
    prompt: |
      Review the following files for code quality:
      {{steps.analyze_structure.outputs.file_list}}

      For each file, check:
      - Code style and formatting
      - Potential bugs
      - Best practices

      Context about the project:
      {{steps.analyze_structure.outputs.project_overview}}
    outputs:
      - name: review_details
        description: 'Detailed review for each file'
        type: string
      - name: issues
        description: 'List of issues found'
        type: string
    config:
      timeout: 1800 # 30 minutes for this step
      retries: 2

  - id: create_report
    type: agent
    name: 'Generate Final Report'
    prompt: |
      Create a markdown report based on this review:
      {{steps.review_files.outputs.review_details}}

      Include:
      - Executive summary
      - Issues found: {{steps.review_files.outputs.issues}}
      - Recommendations
      - Code quality metrics
    outputs:
      - name: report_content
        description: 'The final markdown report'
        type: file
```

## Placeholder System

The workflow supports template placeholders in prompts:

- `{{inputs.name}}` - Reference workflow inputs
- `{{steps.stepId.outputs.name}}` - Reference outputs from previous steps
- Nested access with dot notation for complex data structures

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build the package
npm run build

# Type checking
npm run check
```

## License

Apache 2.0
