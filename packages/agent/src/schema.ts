/**
 * Supported input/output data types for agent workflows.
 * We will add more supported types in the future
 */
export type DataType = 'string' | 'file';

/**
 * Supported AI agent tools/providers
 */
export type AgentTool = 'claude' | 'gemini' | 'codex' | 'qwen';

/**
 * Input parameter definition for the workflow
 */
export interface WorkflowInput {
  /** Parameter name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Data type */
  type: DataType;
  /** Whether this parameter is required */
  required: boolean;
  /** Default value if not required */
  default?: any;
}

/**
 * Output definition for the workflow or individual steps
 */
export interface WorkflowOutput {
  /** Output name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Data type */
  type: DataType;
  /** Filename where the output should be saved (required for 'file' type) */
  filename?: string;
  /** Required fields for object outputs */
  required?: boolean;
}

/**
 * Agent step configuration
 */
export interface AgentStep {
  /** Unique step identifier */
  id: string;
  /** Step type - currently only 'agent' supported */
  type: 'agent';
  /** Human-readable step name */
  name: string;
  /** AI tool/provider to use (optional, uses workflow default) */
  tool?: AgentTool;
  /** Specific model version (optional, uses tool default) */
  model?: string;
  /** Prompt template with placeholder support */
  prompt: string;
  /** Expected outputs from this step */
  outputs: WorkflowOutput[];
  /** Optional step configuration */
  config?: {
    /** Maximum execution time in seconds */
    timeout?: number;
    /** Number of retry attempts on failure */
    retries?: number;
  };
}

/**
 * Complete agent workflow schema
 */
export interface AgentWorkflowSchema {
  /** Schema version for compatibility */
  version: string;
  /** Workflow identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Input parameters required by this workflow */
  inputs: WorkflowInput[];
  /** Expected outputs from the workflow */
  outputs: WorkflowOutput[];
  /** Default configuration when it's not specified. Users will set it using the agent tool */
  defaults?: {
    /** Default AI tool if not specified in steps */
    tool?: AgentTool;
    /** Default model if not specified in steps */
    model?: string;
  };
  /** Optional workflow-level configuration */
  config?: {
    /** Global timeout for entire workflow */
    timeout?: number;
    /** Whether to continue on step failures */
    continueOnError?: boolean;
  };
  /** Ordered list of execution steps */
  steps: AgentStep[];
}
