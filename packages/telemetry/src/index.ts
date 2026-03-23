import { PostHog } from 'posthog-node';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  NewTaskMetadata,
  IterateMetadata,
  InitMetadata,
} from './types.js';

export enum NewTaskProvider {
  INPUT = 'user_input',
  GITHUB = 'github',
}

export type CommandOutcome = 'success' | 'error';

type PendingEvent = {
  event: EVENT_IDS;
  properties: object;
};

type PendingEvents = PendingEvent[];

// Config is injected at build time via tsdown define
declare const __BUILD_CONFIG__: { apiKey: string; host: string };
const config = __BUILD_CONFIG__;

// Constants
// @deprecated Use the GlobalConfigManager from schemas package instead
const CONFIG_DIR = join(homedir(), '.config', 'rover');
const USER_CONFIG_PATH = join(CONFIG_DIR, '.user');
const DISABLE_TELEMETRY_PATH = join(CONFIG_DIR, '.no-telemetry');

// From
export enum TELEMETRY_FROM {
  CLI = 'cli',
  EXTENSION = 'extension',
}

// Identify events
enum EVENT_IDS {
  // An user created a new task
  NEW_TASK = 'new_task',
  // Iterate over an existing task
  ITERATE_TASK = 'iterate_task',
  // Delete a task
  DELETE_TASK = 'delete_task',
  // Show differences between branches
  DIFF = 'diff',
  // Initialize a new project
  INIT = 'init',
  // Inspect task details
  INSPECT_TASK = 'inspect_task',
  // List all tasks
  LIST_TASKS = 'list_tasks',
  // View task logs
  LOGS = 'logs',
  // Merge a task branch
  MERGE_TASK = 'merge_task',
  // Rebase a task branch
  REBASE_TASK = 'rebase_task',
  // Push branch to remote
  PUSH_BRANCH = 'push_branch',
  // Reset current changes
  RESET = 'reset',
  // Restart a task
  RESTART_TASK = 'restart_task',
  // Open shell in container
  SHELL = 'shell',
  // Stop a task
  STOP_TASK = 'stop',
  // List workflows
  LIST_WORKFLOWS = 'list_workflows',
  // Inspect workflow
  INSPECT_WORKFLOW = 'inspect_workflow',
  // Add workflow
  ADD_WORKFLOW = 'add_workflow',
  // Open a workspace in the extension
  OPEN_WORKSPACE = 'open_workspace',
  // Show store information
  INFO = 'info',
  // Clean up stale cache images
  CLEANUP = 'cleanup',
}

class Telemetry {
  private client: PostHog;
  private pendingEvents: PendingEvents = [];

  constructor(
    private userId: string,
    private telemetryFrom: TELEMETRY_FROM,
    private disableTelemetry: boolean
  ) {
    this.client = new PostHog(config.apiKey, {
      host: config.host,
      disabled: disableTelemetry,
      // Improve timeouts
      requestTimeout: 3000,
      fetchRetryCount: 1,
      fetchRetryDelay: 1000,
      // Try to flush sonner than later as
      // this is a CLI process.
      flushAt: 1,
      flushInterval: 100,
    });
  }

  static load(from: TELEMETRY_FROM): Telemetry {
    let userId: string;

    if (existsSync(USER_CONFIG_PATH)) {
      try {
        userId = readFileSync(USER_CONFIG_PATH, 'utf-8').trim();
      } catch (_error) {
        userId = uuidv4();
        Telemetry.writeUserId(userId);
      }
    } else {
      userId = uuidv4();
      Telemetry.writeUserId(userId);
    }

    const isDisabled =
      existsSync(DISABLE_TELEMETRY_PATH) ||
      process.env.ROVER_NO_TELEMETRY === '1' ||
      process.env.ROVER_NO_TELEMETRY === 'true';
    return new Telemetry(userId, from, isDisabled);
  }

  static disableTelemetry() {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    writeFileSync(DISABLE_TELEMETRY_PATH, '');
  }

  static enableTelemetry() {
    if (existsSync(DISABLE_TELEMETRY_PATH)) {
      rmSync(DISABLE_TELEMETRY_PATH);
    }
  }

  // Event definition

  eventNewTask(
    provider: NewTaskProvider,
    workflow?: string,
    isMultiAgent?: boolean,
    agents?: string[]
  ) {
    const metadata: NewTaskMetadata = {
      provider,
      workflow,
      isMultiAgent,
      agents,
    };

    this.queueEvent(EVENT_IDS.NEW_TASK, metadata);
  }

  eventIterateTask(iteration: number) {
    const metadata: IterateMetadata = {
      iteration,
    };

    this.queueEvent(EVENT_IDS.ITERATE_TASK, metadata);
  }

  eventDeleteTask() {
    this.queueEvent(EVENT_IDS.DELETE_TASK);
  }

  eventDiff() {
    this.queueEvent(EVENT_IDS.DIFF);
  }

  eventInit(
    agents: string[],
    preferredAgent: string,
    languages: string[],
    attribution: boolean
  ) {
    const metadata: InitMetadata = {
      agents,
      preferredAgent,
      languages,
      attribution,
    };

    this.queueEvent(EVENT_IDS.INIT, metadata);
  }

  eventInspectTask() {
    this.queueEvent(EVENT_IDS.INSPECT_TASK);
  }

  eventListTasks() {
    this.queueEvent(EVENT_IDS.LIST_TASKS);
  }

  eventLogs() {
    this.queueEvent(EVENT_IDS.LOGS);
  }

  eventMergeTask() {
    this.queueEvent(EVENT_IDS.MERGE_TASK);
  }

  eventRebaseTask() {
    this.queueEvent(EVENT_IDS.REBASE_TASK);
  }

  eventPushBranch() {
    this.queueEvent(EVENT_IDS.PUSH_BRANCH);
  }

  eventReset() {
    this.queueEvent(EVENT_IDS.RESET);
  }

  eventShell() {
    this.queueEvent(EVENT_IDS.SHELL);
  }

  eventStopTask() {
    this.queueEvent(EVENT_IDS.STOP_TASK);
  }

  eventRestartTask() {
    this.queueEvent(EVENT_IDS.RESTART_TASK);
  }

  eventListWorkflows() {
    this.queueEvent(EVENT_IDS.LIST_WORKFLOWS);
  }

  eventInspectWorkflow() {
    this.queueEvent(EVENT_IDS.INSPECT_WORKFLOW);
  }

  eventAddWorkflow() {
    this.queueEvent(EVENT_IDS.ADD_WORKFLOW);
  }

  eventOpenWorkspace() {
    this.queueEvent(EVENT_IDS.OPEN_WORKSPACE);
  }

  eventInfo() {
    this.queueEvent(EVENT_IDS.INFO);
  }

  eventCleanup() {
    this.queueEvent(EVENT_IDS.CLEANUP);
  }

  // Other methods

  async shutdown(outcome?: CommandOutcome) {
    // Send all pending events with the outcome before flushing
    for (const pending of this.pendingEvents) {
      this.capture(pending.event, {
        ...pending.properties,
        ...(outcome !== undefined ? { outcome } : {}),
      });
    }
    this.pendingEvents = [];

    // Suppress PostHog's unconditional console.error in logFlushError
    const origError = console.error;
    console.error = () => {};

    // Store the timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        this.client.shutdown().catch(() => {}),
        new Promise(resolve => {
          timeoutId = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      console.error = origError;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  getUserId(): string {
    return this.userId;
  }

  isDisabled(): boolean {
    return this.disableTelemetry;
  }

  private static writeUserId(userId: string): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(USER_CONFIG_PATH, userId);
  }

  // Store the event to be sent at shutdown time with the outcome
  private queueEvent(event: EVENT_IDS, properties: object = {}) {
    this.pendingEvents.push({ event, properties });
  }

  // Send the capture event to PostHog
  private capture(event: EVENT_IDS, properties: object = {}) {
    this.client.capture({
      distinctId: this.userId,
      event,
      properties: {
        from: this.telemetryFrom,
        ...properties,
      },
    });
  }
}

export default Telemetry;
