#!/usr/bin/env node
/**
 * debug-step — Standalone dev tool for debugging autopilot pipeline steps.
 *
 * Replays a single step (e.g. coordinate) with the exact same context the
 * autopilot would use, but lets you see the full prompt and agent response
 * instead of silently consuming the JSON decision.
 *
 * Usage:
 *   node --enable-source-maps dist/debug-step.mjs coordinate --event event.json
 *   node --enable-source-maps dist/debug-step.mjs coordinate --event event.json --prompt-only
 *   node --enable-source-maps dist/debug-step.mjs coordinate --event event.json --interactive
 *   node --enable-source-maps dist/debug-step.mjs coordinate --event event.json --agent codex
 *   node --enable-source-maps dist/debug-step.mjs coordinate --event event.json --agent gemini
 *
 * The --event file should contain the event meta JSON, same structure as
 * pending.meta in the autopilot (output of extractRelevantEvent). Example:
 *
 *   {
 *     "type": "IssuesEvent",
 *     "action": "opened",
 *     "issueNumber": 42,
 *     "title": "Add retry logic for failed tasks",
 *     "state": "open",
 *     "author": "user",
 *     "labels": ["enhancement"],
 *     "url": "https://github.com/org/repo/issues/42"
 *   }
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOrRegisterProject } from 'rover-core';
import {
  buildCoordinatorQuery,
  buildPlannerQuery,
  fetchMemoryContext,
} from './lib/autopilot/memory/reader.js';
import { MemoryStore } from './lib/autopilot/memory/store.js';
import { buildPilotPrompt } from './lib/autopilot/steps/coordinator.js';
import { buildWorkflowCatalog } from './lib/autopilot/helpers.js';
import { initWorkflowStore } from './lib/workflow.js';
import { parseJsonResponse } from './utils/json-parser.js';
import type { PilotDecision } from './lib/autopilot/types.js';
import colors from 'ansi-colors';

// ── Helpers ─────────────────────────────────────────────────────────────────

function header(text: string): void {
  console.log(colors.cyan.bold(`\n--- ${text} ---\n`));
}

function dim(text: string): void {
  console.log(colors.gray(text));
}

function savePromptToFile(prompt: string, step: string): string {
  const filePath = join(tmpdir(), `rover-debug-${step}-${Date.now()}.md`);
  writeFileSync(filePath, prompt, 'utf8');
  return filePath;
}

// ── Agent configuration ─────────────────────────────────────────────────────

type AgentName = 'claude' | 'codex' | 'gemini';

interface AgentConfig {
  bin: string;
  /** Default model when --model is not specified */
  defaultModel: string;
  /** Base args for piped (non-interactive) mode, without --model */
  pipedArgs(): string[];
  /** Base args for interactive mode, without --model */
  interactiveArgs(): string[];
  /** Build the model flag(s) — placed last before the prompt positional arg */
  modelArgs(model: string): string[];
  /** true = pass prompt as last positional arg; false = pipe via stdin */
  promptAsArg: boolean;
  /** Inject system prompt into the spawn — returns extra args and/or env overrides */
  systemPromptSetup(systemPrompt: string): {
    args: string[];
    env?: Record<string, string>;
    cleanup?: () => void;
  };
  /** Extra args for tool access (if supported) */
  toolArgs(tools: string): string[];
}

const AGENT_CONFIGS: Record<AgentName, AgentConfig> = {
  claude: {
    bin: 'claude',
    defaultModel: 'sonnet',
    pipedArgs: () => ['-p'],
    interactiveArgs: () => [],
    modelArgs: model => ['--model', model],
    promptAsArg: true,
    systemPromptSetup: systemPrompt => ({
      args: ['--system-prompt', systemPrompt],
    }),
    toolArgs: tools => ['--allowedTools', tools],
  },

  codex: {
    bin: 'codex',
    defaultModel: 'gpt-5.3-codex',
    pipedArgs: () => ['exec'],
    interactiveArgs: () => ['exec'],
    modelArgs: model => ['--model', model],
    promptAsArg: false,
    systemPromptSetup: systemPrompt => {
      // Write system prompt to a temp file to avoid shell quoting issues
      const dir = mkdtempSync(join(tmpdir(), 'rover-codex-'));
      const filePath = join(dir, 'system-prompt.md');
      writeFileSync(filePath, systemPrompt, 'utf8');
      return {
        args: ['--config', `developer_instructions_file=${filePath}`],
        cleanup: () => {
          try {
            unlinkSync(filePath);
          } catch {}
        },
      };
    },
    toolArgs: () => [],
  },

  gemini: {
    bin: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    pipedArgs: () => [],
    interactiveArgs: () => [],
    modelArgs: model => ['--model', model],
    promptAsArg: false,
    systemPromptSetup: systemPrompt => {
      const dir = mkdtempSync(join(tmpdir(), 'rover-gemini-'));
      const filePath = join(dir, 'system-prompt.md');
      writeFileSync(filePath, systemPrompt, 'utf8');
      return {
        args: [],
        env: { GEMINI_SYSTEM_MD: filePath },
        cleanup: () => {
          try {
            unlinkSync(filePath);
          } catch {}
        },
      };
    },
    toolArgs: () => [],
  },
};

const SUPPORTED_AGENTS: AgentName[] = ['claude', 'codex', 'gemini'];
const DEFAULT_TOOLS = 'Read,Glob,Grep,Bash(gh:*),Bash(git:*)';

// ── Generic agent invocation ────────────────────────────────────────────────

async function invokePiped(
  agentName: AgentName,
  systemPrompt: string,
  userMessage: string,
  model: string,
  tools: string
): Promise<string> {
  const config = AGENT_CONFIGS[agentName];
  const setup = config.systemPromptSetup(systemPrompt);

  // --model must come last (before any positional prompt arg) so the claude
  // CLI doesn't swallow subsequent flags as part of the prompt text.
  const args = [
    ...config.pipedArgs(),
    ...setup.args,
    ...config.toolArgs(tools),
    ...config.modelArgs(model),
  ];

  const spawnEnv = setup.env ? { ...process.env, ...setup.env } : process.env;

  // Append the JSON enforcement suffix (same as AIAgentTool.invoke with json: true)
  const invokePrompt =
    userMessage +
    '\n\nYou MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.';

  try {
    const rawOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.bin, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: spawnEnv,
      });

      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        process.stdout.write(text);
        output += text;
      });

      child.stdin.write(invokePrompt);
      child.stdin.end();

      child.on('close', code => {
        if (code === 0) resolve(output);
        else reject(new Error(`${config.bin} exited with code ${code}`));
      });
      child.on('error', reject);
    });

    return rawOutput;
  } finally {
    setup.cleanup?.();
  }
}

async function invokeInteractive(
  agentName: AgentName,
  systemPrompt: string,
  userMessage: string,
  model: string,
  tools: string
): Promise<void> {
  const config = AGENT_CONFIGS[agentName];
  const setup = config.systemPromptSetup(systemPrompt);

  // --model must come last (before the prompt positional arg) so the claude
  // CLI doesn't swallow subsequent flags as part of the prompt text.
  const args = [
    ...config.interactiveArgs(),
    ...setup.args,
    ...config.toolArgs(tools),
    ...config.modelArgs(model),
  ];

  const spawnEnv = setup.env ? { ...process.env, ...setup.env } : process.env;

  try {
    if (config.promptAsArg) {
      // Pass user message as last positional arg (Claude-style)
      args.push(userMessage);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(config.bin, args, {
          stdio: 'inherit',
          env: spawnEnv,
        });
        child.on('close', () => resolve());
        child.on('error', reject);
      });
    } else {
      // Pipe user message via stdin, but keep stdout/stderr inherited
      await new Promise<void>((resolve, reject) => {
        const child = spawn(config.bin, args, {
          stdio: ['pipe', 'inherit', 'inherit'],
          env: spawnEnv,
        });
        child.stdin.write(userMessage);
        child.stdin.end();
        child.on('close', () => resolve());
        child.on('error', reject);
      });
    }
  } finally {
    setup.cleanup?.();
  }
}

function parseAgentOutput(rawOutput: string): string {
  let textToParse = rawOutput.trim();

  // claude -p may wrap output in {"result": "..."} envelope. Handle both cases.
  try {
    const envelope = JSON.parse(textToParse);
    if (typeof envelope.result === 'string') {
      textToParse = envelope.result;
    }
  } catch {
    // Not an envelope — treat as raw text
  }

  return textToParse;
}

// ── Coordinate step ─────────────────────────────────────────────────────────

interface CoordinateContext {
  memoryContent: string;
  memoryCount: number;
  memoryQuery: string;
  systemPrompt: string;
  userMessage: string;
}

async function gatherCoordinateContext(
  meta: Record<string, any>,
  projectId: string,
  projectPath: string
): Promise<CoordinateContext> {
  // 1. Memory context
  header('Memory context');
  const memoryStore = new MemoryStore(projectId);
  await memoryStore.ensureSetup();
  const memoryQuery = buildCoordinatorQuery(meta);
  dim(`  Query: "${memoryQuery}"`);
  const memory = await fetchMemoryContext(memoryStore, memoryQuery, 5);
  if (memory.content) {
    console.log(colors.green(`  ${memory.count} result(s) found`));
  } else {
    dim('  (no results)');
  }

  // 2. Build system prompt (identical to coordinator.ts)
  header('Assembling prompt');
  const workflowStore = initWorkflowStore(projectPath);
  const workflowCatalog = buildWorkflowCatalog(workflowStore);
  const entries = workflowStore.getAllWorkflowEntries();
  dim(`  Loaded ${entries.length} workflow(s)`);
  const systemPrompt = buildPilotPrompt(
    memory.content || undefined,
    workflowCatalog
  );
  dim(`  System prompt: ${systemPrompt.length} characters`);

  // 3. Build user message
  const userMessage =
    '## Event\n\n```json\n' + JSON.stringify(meta, null, 2) + '\n```\n';
  dim(`  User message: ${userMessage.length} characters`);

  return {
    memoryContent: memory.content,
    memoryCount: memory.count,
    memoryQuery,
    systemPrompt,
    userMessage,
  };
}

async function runCoordinate(
  meta: Record<string, any>,
  options: {
    promptOnly?: boolean;
    interactive?: boolean;
    model?: string;
    agent?: AgentName;
  },
  projectId: string,
  projectPath: string
): Promise<void> {
  const ctx = await gatherCoordinateContext(meta, projectId, projectPath);
  const agentName = options.agent || 'claude';

  const fullPrompt = `${ctx.systemPrompt}\n\n---\n\n${ctx.userMessage}`;
  const promptFile = savePromptToFile(fullPrompt, 'coordinate');
  dim(`  Saved to: ${promptFile}`);

  // --- Prompt-only mode ---
  if (options.promptOnly) {
    header('System Prompt');
    console.log(ctx.systemPrompt);
    header('User Message');
    console.log(ctx.userMessage);
    header('Agent Info');
    dim(`  Agent: ${agentName}`);
    dim(`  Binary: ${AGENT_CONFIGS[agentName].bin}`);
    if (agentName === 'gemini') {
      dim('  System prompt will be passed via GEMINI_SYSTEM_MD env var');
    } else if (agentName === 'codex') {
      dim(
        '  System prompt will be passed via --config developer_instructions_file'
      );
    }
    return;
  }

  const model = options.model || AGENT_CONFIGS[agentName].defaultModel;

  // --- Interactive mode ---
  if (options.interactive) {
    header(`Interactive Session (agent: ${agentName}, model: ${model})`);
    dim(
      `${agentName} will process the prompt with read-only tools and enter interactive mode.\n` +
        'You can ask follow-up questions like "why not plan?" or "what if the labels included bug?".\n'
    );

    return invokeInteractive(
      agentName,
      ctx.systemPrompt,
      ctx.userMessage,
      model,
      DEFAULT_TOOLS
    );
  }

  // --- Default: piped mode with full output ---
  header(`Invoking Agent (agent: ${agentName}, model: ${model})`);
  dim(
    `Running ${agentName} in piped mode with read-only tools. Full response below:\n`
  );

  const rawOutput = await invokePiped(
    agentName,
    ctx.systemPrompt,
    ctx.userMessage,
    model,
    DEFAULT_TOOLS
  );

  // Parse the decision
  header('Parsed Decision');
  try {
    const textToParse = parseAgentOutput(rawOutput);
    const decision = parseJsonResponse<PilotDecision>(textToParse);
    console.log(JSON.stringify(decision, null, 2));
  } catch (err) {
    console.log(colors.yellow('Could not parse JSON decision from response.'));
    dim(`${err}`);
  }
}

// ── Plan step ───────────────────────────────────────────────────────────────

async function runPlan(
  meta: Record<string, any>,
  options: {
    promptOnly?: boolean;
    interactive?: boolean;
    model?: string;
    spans?: string;
    agent?: AgentName;
  },
  projectId: string,
  projectPath: string
): Promise<void> {
  // Load plan prompt template
  const { default: planPromptTemplate } = await import(
    './lib/autopilot/steps/prompts/plan-prompt.md'
  );

  const agentName = options.agent || 'claude';

  header('Building plan context');

  // Load spans if provided (JSON file with array of Span objects)
  let spans: any[] = [];
  if (options.spans) {
    try {
      spans = JSON.parse(readFileSync(options.spans, 'utf8'));
      console.log(colors.green(`  Loaded ${spans.length} span(s) from file`));
    } catch (err) {
      dim(`  Failed to load spans file: ${err}`);
    }
  } else {
    dim('  (no spans file provided — use --spans for full trace context)');
  }

  // Build user message (same as planner.ts buildPlanUserMessage)
  let userMessage = '## Plan Directive\n\n```json\n';
  userMessage += JSON.stringify(meta, null, 2);
  userMessage += '\n```\n';

  if (spans.length > 0) {
    userMessage += '\n## Spans\n\n';
    for (const span of spans) {
      userMessage += `### Span: ${span.step} (${span.id})\n\n`;
      userMessage += `- **timestamp**: ${span.timestamp}\n`;
      userMessage += `- **summary**: ${span.summary}\n`;
      userMessage += `- **parent**: ${span.parent ?? 'null'}\n\n`;
      userMessage += '```json\n';
      userMessage += JSON.stringify(span.meta, null, 2);
      userMessage += '\n```\n\n';
    }
  }

  // Memory context
  header('Memory context');
  const memoryStore = new MemoryStore(projectId);
  await memoryStore.ensureSetup();
  const memoryQuery = buildPlannerQuery(meta, spans);
  dim(`  Query: "${memoryQuery}"`);
  const memory = await fetchMemoryContext(memoryStore, memoryQuery, 5);
  if (memory.content) {
    console.log(colors.green(`  ${memory.count} result(s) found`));
    userMessage += '\n' + memory.content;
  } else {
    dim('  (no results)');
  }

  // Build system prompt with real workflow catalog
  header('Workflows');
  const workflowStore = initWorkflowStore(projectPath);
  const workflowCatalog = buildWorkflowCatalog(workflowStore);
  const entries = workflowStore.getAllWorkflowEntries();
  dim(`  Loaded ${entries.length} workflow(s)`);
  let systemPrompt: string = planPromptTemplate;
  systemPrompt = systemPrompt.replace('{{WORKFLOW_CATALOG}}', workflowCatalog);

  // For prompt-only, show both system and user messages
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  header('Assembling prompt');
  dim(`  System prompt: ${systemPrompt.length} chars`);
  dim(`  User message: ${userMessage.length} chars`);

  const promptFile = savePromptToFile(fullPrompt, 'plan');
  dim(`  Saved to: ${promptFile}`);

  if (options.promptOnly) {
    header('System Prompt');
    console.log(systemPrompt);
    header('User Message');
    console.log(userMessage);
    header('Agent Info');
    dim(`  Agent: ${agentName}`);
    dim(`  Binary: ${AGENT_CONFIGS[agentName].bin}`);
    if (agentName === 'gemini') {
      dim('  System prompt will be passed via GEMINI_SYSTEM_MD env var');
    } else if (agentName === 'codex') {
      dim(
        '  System prompt will be passed via --config developer_instructions_file'
      );
    }
    return;
  }

  const model = options.model || AGENT_CONFIGS[agentName].defaultModel;

  if (options.interactive) {
    header(`Interactive Session (agent: ${agentName}, model: ${model})`);
    dim(
      `${agentName} will process the prompt with read-only tools and enter interactive mode.\n`
    );

    return invokeInteractive(
      agentName,
      systemPrompt,
      userMessage,
      model,
      DEFAULT_TOOLS
    );
  }

  // Default: piped mode
  header(`Invoking Agent (agent: ${agentName}, model: ${model})`);
  dim(
    `Running ${agentName} in piped mode with read-only tools. Full response below:\n`
  );

  const rawOutput = await invokePiped(
    agentName,
    systemPrompt,
    userMessage,
    model,
    DEFAULT_TOOLS
  );

  header('Parsed Plan');
  try {
    const textToParse = parseAgentOutput(rawOutput);
    const plan = parseJsonResponse<any>(textToParse);
    console.log(JSON.stringify(plan, null, 2));
  } catch (err) {
    console.log(colors.yellow('Could not parse JSON plan from response.'));
    dim(`${err}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('debug-step')
  .description(
    'Debug an autopilot pipeline step by replaying it with full visibility.\n' +
      'Gathers the exact same context as the autopilot, then lets you see\n' +
      'the full prompt, raw agent response, and parsed decision.'
  )
  .argument('<step>', 'Step to debug: coordinate, plan')
  .requiredOption(
    '--event <path>',
    'Path to JSON file with event metadata (same shape as pending.meta)'
  )
  .option(
    '--prompt-only',
    'Only print the assembled prompt — do not invoke the agent'
  )
  .option(
    '--interactive',
    'Start an interactive agent session with the prompt pre-loaded'
  )
  .option(
    '--model <model>',
    'Override the AI model (defaults: claude=sonnet, codex=o4-mini, gemini=gemini-2.5-pro)'
  )
  .option('--agent <name>', 'Agent to use: claude, codex, gemini', 'claude')
  .option(
    '--spans <path>',
    'Path to JSON file with span trace (array of Span objects, used by plan step)'
  )
  .action(
    async (
      step: string,
      options: {
        event: string;
        promptOnly?: boolean;
        interactive?: boolean;
        model?: string;
        agent?: string;
        spans?: string;
      }
    ) => {
      const supportedSteps = ['coordinate', 'plan'];
      if (!supportedSteps.includes(step)) {
        console.error(
          `Unknown step "${step}". Supported: ${supportedSteps.join(', ')}`
        );
        process.exit(1);
      }

      // Validate --agent
      const agentName = (options.agent || 'claude') as AgentName;
      if (!SUPPORTED_AGENTS.includes(agentName)) {
        console.error(
          `Unknown agent "${options.agent}". Supported: ${SUPPORTED_AGENTS.join(', ')}`
        );
        process.exit(1);
      }

      // Parse event file
      let meta: Record<string, any>;
      try {
        const raw = readFileSync(options.event, 'utf8');
        meta = JSON.parse(raw);
      } catch (err) {
        console.error(`Failed to read event file "${options.event}": ${err}`);
        process.exit(1);
      }

      // Resolve project from cwd
      let project;
      try {
        project = await findOrRegisterProject();
      } catch (err) {
        console.error(
          `Could not resolve project from cwd. Run this from a Rover-registered git repo.\n${err}`
        );
        process.exit(1);
      }

      if (!project) {
        console.error(
          'No project found. Run this from a directory with a registered Rover project.'
        );
        process.exit(1);
      }

      const projectPath = project.path;
      const projectId = project.id;

      console.log(colors.bold(`\nDebug Step: ${step}`));
      dim(`Project: ${project.name} (${projectId})`);
      dim(`Event file: ${options.event}`);
      dim(`Event type: ${meta.type || '(unknown)'}`);
      dim(`Agent: ${agentName}`);

      switch (step) {
        case 'coordinate':
          await runCoordinate(
            meta,
            { ...options, agent: agentName },
            projectId,
            projectPath
          );
          break;
        case 'plan':
          await runPlan(
            meta,
            { ...options, agent: agentName },
            projectId,
            projectPath
          );
          break;
      }
    }
  );

program.parse();
