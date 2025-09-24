# @endorhq/agent

The Rover Agent package is a library and binary to process, build and run agent workflow definitions in Rover. An _agent workflow_ is a definition of an agentic process to complete a specific task. It contains a set of inputs, outputs and steps.

For example, a common agent workflow is a software engineer (SWE) that takes a task description and implements changes in the code. It requires going through a set of steps like getting context, planning, implementing, and summarizing.

## Installation

```bash
npm install @endorhq/agent
```

## Usage

### Loading a Workflow

```typescript
import { AgentWorkflow } from '@endorhq/agent';

// Load from file
const workflow = AgentWorkflow.load('/path/to/workflow.yml');

// Create from scratch
const workflow = AgentWorkflow.create(
  '/path/to/workflow.yml',
  'my-workflow',
  'A workflow that processes data',
  inputs,
  outputs,
  steps
);

// Load from YAML string
const yamlContent = fs.readFileSync('workflow.yml', 'utf8');
const workflow = AgentWorkflow.fromYaml(yamlContent, 'workflow.yml');
```

### Accessing Workflow Data

```typescript
// Get workflow metadata
console.log(workflow.name); // Workflow name
console.log(workflow.description); // Workflow description
console.log(workflow.version); // Schema version

// Access inputs and outputs
workflow.inputs.forEach(input => {
  console.log(`Input: ${input.name} (${input.type})`);
});

workflow.outputs.forEach(output => {
  console.log(`Output: ${output.name} (${output.type})`);
});

// Get step information
const step = workflow.getStep('analyze_structure');
const tool = workflow.getStepTool('analyze_structure'); // Returns tool with fallback to defaults
const model = workflow.getStepModel('analyze_structure'); // Returns model with fallback to defaults
const timeout = workflow.getStepTimeout('analyze_structure'); // Returns timeout in seconds
```

### Validating and Saving

```typescript
// Validation happens automatically on load and save
try {
  workflow.save(); // Validates and saves to file
} catch (error) {
  console.error('Validation error:', error.message);
}

// Export to YAML string
const yamlString = workflow.toYaml();
```

## Schema

The agent workflow schema defines the structure of YAML workflow definitions:

```typescript
interface AgentWorkflowSchema {
  // Required fields
  version: string; // Schema version (currently "1.0")
  name: string; // Unique workflow identifier
  description: string; // Human-readable description
  inputs: WorkflowInput[]; // Input parameters
  outputs: WorkflowOutput[]; // Expected outputs
  steps: AgentStep[]; // Execution steps

  // Optional configuration
  defaults?: {
    tool?: 'claude' | 'gemini' | 'codex' | 'qwen'; // Default AI tool
    model?: string; // Default model version
  };
  config?: {
    timeout?: number; // Global timeout in seconds
    continueOnError?: boolean; // Whether to continue on failures
  };
}
```

### Input Definition

```typescript
interface WorkflowInput {
  name: string; // Parameter name
  description: string; // Human-readable description
  type: 'string' | 'file'; // Data type
  required: boolean; // Whether required
  default?: any; // Default value if not required
}
```

### Output Definition

```typescript
interface WorkflowOutput {
  name: string; // Output name
  description: string; // Human-readable description
  type: 'string' | 'file'; // Data type
  required?: boolean; // Whether required
}
```

### Step Definition

```typescript
interface AgentStep {
  id: string; // Unique step identifier
  type: 'agent'; // Step type (currently only 'agent')
  name: string; // Human-readable name
  prompt: string; // Prompt template with {{placeholders}}
  outputs: WorkflowOutput[]; // Expected outputs

  // Optional configuration
  tool?: 'claude' | 'gemini' | 'codex' | 'qwen'; // Override default tool
  model?: string; // Override default model
  config?: {
    timeout?: number; // Step-specific timeout in seconds
    retries?: number; // Number of retry attempts
  };
}
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

## Migration

The workflow system includes automatic migration for older schema versions. When loading a workflow with an older version, it will be automatically upgraded to the current version and saved.

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
