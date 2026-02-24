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
import { readFileSync, writeFileSync } from 'node:fs';
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
  projectId: string
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
  const workflowCatalog =
    '*(No workflows loaded in debug mode — provide via --workflows if needed)*';
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
  options: { promptOnly?: boolean; interactive?: boolean; model?: string },
  projectId: string
): Promise<void> {
  const ctx = await gatherCoordinateContext(meta, projectId);

  const fullPrompt = `${ctx.systemPrompt}\n\n---\n\n${ctx.userMessage}`;
  const promptFile = savePromptToFile(fullPrompt, 'coordinate');
  dim(`  Saved to: ${promptFile}`);

  // --- Prompt-only mode ---
  if (options.promptOnly) {
    header('System Prompt');
    console.log(ctx.systemPrompt);
    header('User Message');
    console.log(ctx.userMessage);
    return;
  }

  const model = options.model || 'sonnet';

  // --- Interactive mode ---
  if (options.interactive) {
    header(`Interactive Session (model: ${model})`);
    dim(
      'Claude will process the prompt with read-only tools and enter interactive mode.\n' +
        'You can ask follow-up questions like "why not plan?" or "what if the labels included bug?".\n'
    );

    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        'claude',
        [
          '--system-prompt',
          ctx.systemPrompt,
          '--allowedTools',
          'Read,Glob,Grep,Bash(gh:*),Bash(git:*)',
          '--model',
          model,
          ctx.userMessage,
        ],
        { stdio: 'inherit' }
      );
      child.on('close', () => resolve());
      child.on('error', reject);
    });
  }

  // --- Default: piped mode with full output ---
  header(`Invoking Agent (model: ${model})`);
  dim(
    'Running claude in piped mode with read-only tools. Full response below:\n'
  );

  // Append the JSON enforcement suffix (same as AIAgentTool.invoke with json: true)
  const invokePrompt =
    ctx.userMessage +
    '\n\nYou MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.';

  const rawOutput = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--system-prompt',
        ctx.systemPrompt,
        '--allowedTools',
        'Read,Glob,Grep,Bash(gh:*),Bash(git:*)',
        '--model',
        model,
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] }
    );

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
      else reject(new Error(`claude exited with code ${code}`));
    });
    child.on('error', reject);
  });

  // Parse the decision
  header('Parsed Decision');
  try {
    let textToParse = rawOutput.trim();

    // claude -p without --output-format json returns raw text.
    // With --output-format json it wraps in {"result": "..."}. Handle both.
    try {
      const envelope = JSON.parse(textToParse);
      if (typeof envelope.result === 'string') {
        textToParse = envelope.result;
      }
    } catch {
      // Not an envelope — treat as raw text
    }

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
  },
  projectId: string,
  projectPath: string
): Promise<void> {
  // Load plan prompt template
  const { default: planPromptTemplate } = await import(
    './lib/autopilot/steps/prompts/plan-prompt.md'
  );

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

  // Build system prompt (replace workflow catalog placeholder)
  let systemPrompt: string = planPromptTemplate;
  systemPrompt = systemPrompt.replace(
    '{{WORKFLOW_CATALOG}}',
    '*(No workflows loaded in debug mode — provide via --workflows if needed)*'
  );

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
    return;
  }

  const model = options.model || 'sonnet';

  if (options.interactive) {
    header(`Interactive Session (model: ${model})`);
    dim(
      'Claude will process the prompt with read-only tools and enter interactive mode.\n'
    );

    // In interactive mode, pass system prompt and user message as the initial message
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        'claude',
        [
          '--system-prompt',
          systemPrompt,
          '--allowedTools',
          'Read,Glob,Grep,Bash(gh:*),Bash(git:*)',
          '--model',
          model,
          userMessage,
        ],
        { stdio: 'inherit' }
      );
      console.log('Launching with: ', child.spawnargs);
      child.on('close', () => resolve());
      child.on('error', reject);
    });
  }

  // Default: piped mode
  header(`Invoking Agent (model: ${model})`);
  dim(
    'Running claude in piped mode with read-only tools. Full response below:\n'
  );

  const invokePrompt =
    userMessage +
    '\n\nYou MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.';

  const rawOutput = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--system-prompt',
        systemPrompt,
        '--allowedTools',
        'Read,Glob,Grep,Bash(gh:*),Bash(git:*)',
        '--model',
        model,
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] }
    );

    console.log('Launching with: ', child.spawnargs);

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
      else reject(new Error(`claude exited with code ${code}`));
    });
    child.on('error', reject);
  });

  header('Parsed Plan');
  try {
    let textToParse = rawOutput.trim();
    try {
      const envelope = JSON.parse(textToParse);
      if (typeof envelope.result === 'string') textToParse = envelope.result;
    } catch {}

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
    'Start an interactive claude session with the prompt pre-loaded'
  )
  .option(
    '--model <model>',
    'Override the AI model (default: sonnet for both coordinate and plan)'
  )
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

      switch (step) {
        case 'coordinate':
          await runCoordinate(meta, options, projectId);
          break;
        case 'plan':
          await runPlan(meta, options, projectId, projectPath);
          break;
      }
    }
  );

program.parse();
