import { PostHog } from 'posthog-node';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { NewTaskMetadata, IterateMetadata, InitMetadata } from './types.js';

export enum NewTaskProvider {
  INPUT = 'user_input',
  GITHUB = 'github',
}

// Config is injected at build time via tsdown define
declare const __BUILD_CONFIG__: { apiKey: string; host: string };
const config = __BUILD_CONFIG__;

// Constants
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
  // Open a workspace in the extension
  OPEN_WORKSPACE = 'open_workspace',
}

class Telemetry {
  private client: PostHog;

  constructor(
    private userId: string,
    private telemetryFrom: TELEMETRY_FROM,
    disableTelemetry: boolean
  ) {
    this.client = new PostHog(config.apiKey, {
      host: config.host,
      disabled: disableTelemetry,
    });
  }

  static load(from: TELEMETRY_FROM): Telemetry {
    let userId: string;

    if (existsSync(USER_CONFIG_PATH)) {
      try {
        userId = readFileSync(USER_CONFIG_PATH, 'utf-8').trim();
      } catch (error) {
        userId = uuidv4();
        this.writeUserId(userId);
      }
    } else {
      userId = uuidv4();
      this.writeUserId(userId);
    }

    const isDisabled =
      existsSync(DISABLE_TELEMETRY_PATH) ||
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

  eventNewTask(provider: NewTaskProvider, workflow?: string) {
    const metadata: NewTaskMetadata = {
      provider,
      workflow,
    };

    this.capture(EVENT_IDS.NEW_TASK, metadata);
  }

  eventIterateTask(iteration: number) {
    const metadata: IterateMetadata = {
      iteration,
    };

    this.capture(EVENT_IDS.ITERATE_TASK, metadata);
  }

  eventDeleteTask() {
    this.capture(EVENT_IDS.DELETE_TASK);
  }

  eventDiff() {
    this.capture(EVENT_IDS.DIFF);
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

    this.capture(EVENT_IDS.INIT, metadata);
  }

  eventInspectTask() {
    this.capture(EVENT_IDS.INSPECT_TASK);
  }

  eventListTasks() {
    this.capture(EVENT_IDS.LIST_TASKS);
  }

  eventLogs() {
    this.capture(EVENT_IDS.LOGS);
  }

  eventMergeTask() {
    this.capture(EVENT_IDS.MERGE_TASK);
  }

  eventPushBranch() {
    this.capture(EVENT_IDS.PUSH_BRANCH);
  }

  eventReset() {
    this.capture(EVENT_IDS.RESET);
  }

  eventShell() {
    this.capture(EVENT_IDS.SHELL);
  }

  eventStopTask() {
    this.capture(EVENT_IDS.STOP_TASK);
  }

  eventRestartTask() {
    this.capture(EVENT_IDS.RESTART_TASK);
  }

  eventListWorkflows() {
    this.capture(EVENT_IDS.LIST_WORKFLOWS);
  }

  eventInspectWorkflow() {
    this.capture(EVENT_IDS.INSPECT_WORKFLOW);
  }

  eventOpenWorkspace() {
    this.capture(EVENT_IDS.OPEN_WORKSPACE);
  }

  // Other methods

  async shutdown() {
    await this.client.shutdown();
  }

  getUserId(): string {
    return this.userId;
  }

  private static writeUserId(userId: string): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(USER_CONFIG_PATH, userId);
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
