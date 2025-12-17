import colors from 'ansi-colors';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, posix as pathPosix } from 'node:path';
import { TaskDescriptionManager, WorkflowManager } from 'rover-schemas';
import { findProjectRoot } from 'rover-core';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { getTelemetry } from '../lib/telemetry.js';
import { initWorkflowStore } from '../lib/workflow.js';
import { setJsonMode } from '../lib/global-state.js';
import { CLIJsonOutput } from '../types.js';
import { createSandbox } from '../lib/sandbox/index.js';
import { getNextTaskId } from '../utils/task-id.js';
import { IterationManager } from 'rover-schemas';
import { ProjectConfigManager } from 'rover-schemas';
import { resolveAgentImage } from '../lib/sandbox/container-common.js';

/**
 * Interface for the JSON output
 */
interface CompareTaskOutput extends CLIJsonOutput {
  taskId?: number;
  comparisonReport?: string;
  savedTo?: string;
  workspace?: string;
}

/**
 * Command options
 */
interface CompareOptions {
  json?: boolean;
  agent?: string;
}

interface TaskDocumentSource {
  filename: string;
  sourcePath: string;
}

const COMPARISON_DOCUMENTS_DIR = 'comparison-docs';

/**
 * Compare command
 */
export const compareCommand = async (
  taskIds: string[],
  options: CompareOptions = {}
) => {
  const telemetry = getTelemetry();
  const { json, agent } = options;

  // Set global JSON mode
  if (json !== undefined) {
    setJsonMode(json);
  }

  const jsonOutput: CompareTaskOutput = {
    success: false,
  };

  // Validate we have at least 2 tasks to compare
  if (!taskIds || taskIds.length < 2) {
    jsonOutput.error =
      'At least 2 task IDs are required for comparison. Please provide multiple task IDs.';
    await exitWithError(jsonOutput, {
      tips: ['Example: ' + colors.cyan('rover compare 1 2 3')],
      telemetry,
    });
    return;
  }

  // Limit to 5 tasks to avoid overwhelming output
  if (taskIds.length > 5) {
    jsonOutput.error =
      'Maximum of 5 tasks can be compared at once. Please provide fewer task IDs.';
    await exitWithError(jsonOutput, {
      tips: ['Example: ' + colors.cyan('rover compare 1 2 3 4 5')],
      telemetry,
    });
    return;
  }

  // Parse and validate task IDs
  const parsedTaskIds: number[] = [];
  for (const taskIdStr of taskIds) {
    const taskId = parseInt(taskIdStr, 10);
    if (isNaN(taskId)) {
      jsonOutput.error = `Invalid task ID: '${taskIdStr}'. Task IDs must be numbers.`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
    parsedTaskIds.push(taskId);
  }

  // Check if rover is initialized
  const roverPath = join(findProjectRoot(), '.rover');
  if (!existsSync(roverPath)) {
    jsonOutput.error = 'Rover is not initialized in this directory';
    await exitWithError(jsonOutput, {
      tips: ['Run ' + colors.cyan('rover init') + ' first'],
      telemetry,
    });
    return;
  }

  // Validate all tasks exist and load their metadata
  const tasks: TaskDescriptionManager[] = [];
  for (const taskId of parsedTaskIds) {
    if (!TaskDescriptionManager.exists(taskId)) {
      jsonOutput.error = `Task ${taskId} does not exist`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    try {
      const task = TaskDescriptionManager.load(taskId);
      tasks.push(task);

      // Warn about non-completed tasks
      if (task.status !== 'COMPLETED') {
        if (!json) {
          console.warn(
            colors.yellow(
              `Warning: Task ${taskId} has status '${task.status}' and may not have complete results`
            )
          );
        }
      }
    } catch (error) {
      jsonOutput.error = `Failed to load task ${taskId}: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  }

  // Load the swe-compare workflow
  let workflow: WorkflowManager;
  const workflowName = 'swe-compare';

  try {
    const workflowStore = initWorkflowStore();
    const loadedWorkflow = workflowStore.getWorkflow(workflowName);

    if (loadedWorkflow) {
      workflow = loadedWorkflow;
    } else {
      jsonOutput.error = `Could not load the '${workflowName}' workflow`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } catch (err) {
    jsonOutput.error = `There was an error loading the '${workflowName}' workflow: ${err}`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  const taskDocumentSources = new Map<number, TaskDocumentSource[]>();

  if (!json) {
    console.log(
      colors.gray(
        `\nComparing ${tasks.length} tasks: ${parsedTaskIds.join(', ')}`
      )
    );
  }

  // Prepare comparison data for workflow inputs
  const comparisonData = tasks.map(task => {
    const lastIteration = task.getLastIteration();
    const documentSources: TaskDocumentSource[] = [];
    const documents: { name: string; path: string }[] = [];

    if (lastIteration) {
      const markdownFiles = lastIteration.listMarkdownFiles();

      for (const file of markdownFiles) {
        const sourcePath = join(lastIteration.iterationPath, file);
        if (!existsSync(sourcePath)) {
          continue;
        }

        documentSources.push({
          filename: file,
          sourcePath,
        });

        documents.push({
          name: file,
          path: pathPosix.join(
            COMPARISON_DOCUMENTS_DIR,
            `task-${task.id}`,
            file
          ),
        });
      }
    }

    taskDocumentSources.set(task.id, documentSources);

    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      agent: task.agent,
      workflowName: task.workflowName,
      latestIteration: lastIteration?.iteration ?? task.iterations,
      outputDocuments: documents,
    };
  });

  const inputsData: Map<string, string> = new Map();
  inputsData.set('tasks', JSON.stringify(comparisonData));
  inputsData.set('task_count', tasks.length.toString());
  inputsData.set('task_ids', parsedTaskIds.join(','));
  inputsData.set(
    'task_documents',
    JSON.stringify(
      comparisonData.map(task => ({
        taskId: task.taskId,
        documents: task.outputDocuments,
      }))
    )
  );

  // Create a new task for the comparison workflow
  const comparisonTaskId = getNextTaskId();
  const tasksPath = join(roverPath, 'tasks');
  const taskPath = join(tasksPath, comparisonTaskId.toString());

  // Ensure directories exist
  if (!existsSync(tasksPath)) {
    mkdirSync(tasksPath, { recursive: true });
  }
  mkdirSync(taskPath, { recursive: true });

  // Determine which agent to use (default to claude if not specified)
  const selectedAgent = agent || 'claude';

  // Create comparison task metadata
  const comparisonTask = TaskDescriptionManager.create({
    id: comparisonTaskId,
    title: `Comparison of tasks: ${parsedTaskIds.join(', ')}`,
    description: `Comparing ${tasks.length} tasks to analyze implementation approaches, architectural decisions, and trade-offs.`,
    inputs: inputsData,
    workflowName: workflowName,
    agent: selectedAgent,
    sourceBranch: undefined,
  });

  const iterationPath = join(
    taskPath,
    'iterations',
    comparisonTask.iterations.toString()
  );
  mkdirSync(iterationPath, { recursive: true });

  const comparisonWorkspaceName = `compare-tasks-${parsedTaskIds.join('-')}`;
  const comparisonWorkspaceRelativePath = join(
    '.rover',
    'tasks',
    comparisonTaskId.toString(),
    comparisonWorkspaceName
  );
  const comparisonWorkspacePath = join(taskPath, comparisonWorkspaceName);
  mkdirSync(comparisonWorkspacePath, { recursive: true });
  comparisonTask.setWorkspace(comparisonWorkspacePath, comparisonWorkspaceName);
  jsonOutput.workspace = comparisonWorkspaceRelativePath;

  const documentsRootPath = join(
    comparisonWorkspacePath,
    COMPARISON_DOCUMENTS_DIR
  );
  mkdirSync(documentsRootPath, { recursive: true });

  for (const [taskId, documents] of taskDocumentSources.entries()) {
    if (!documents || documents.length === 0) {
      continue;
    }

    const taskDocumentsPath = join(
      documentsRootPath,
      `task-${taskId.toString()}`
    );
    mkdirSync(taskDocumentsPath, { recursive: true });

    for (const document of documents) {
      const destinationPath = join(taskDocumentsPath, document.filename);
      try {
        copyFileSync(document.sourcePath, destinationPath);
      } catch (error) {
        if (!json) {
          console.warn(
            colors.yellow(
              `Warning: Failed to copy document ${document.filename} for task ${taskId}: ${error}`
            )
          );
        }
      }
    }
  }

  if (!json) {
    console.log(
      colors.gray('Comparison workspace: ') +
        colors.cyan(comparisonWorkspaceRelativePath)
    );
  }

  // Create initial iteration.json
  IterationManager.createInitial(
    iterationPath,
    comparisonTask.id,
    comparisonTask.title,
    comparisonTask.description
  );

  comparisonTask.markInProgress();

  // Resolve and store the agent image
  const projectConfig = ProjectConfigManager.load();
  const agentImage = resolveAgentImage(projectConfig);
  comparisonTask.setAgentImage(agentImage);

  // Start sandbox container for comparison workflow execution
  try {
    const sandbox = await createSandbox(comparisonTask, undefined);
    const containerId = await sandbox.createAndStart();

    comparisonTask.setContainerInfo(containerId, 'running');

    if (!json) {
      console.log(
        colors.green(`\n✓ Comparison task ${comparisonTaskId} started`)
      );
      console.log(
        colors.gray(
          `  Use ${colors.cyan(`rover logs -f ${comparisonTaskId}`)} to watch the comparison progress`
        )
      );
    }

    jsonOutput.success = true;
    jsonOutput.taskId = comparisonTaskId;
    jsonOutput.savedTo = `.rover/tasks/${comparisonTaskId}/description.json`;
    jsonOutput.workspace = comparisonWorkspaceRelativePath;

    await exitWithSuccess(
      `Comparison task ${comparisonTaskId} created successfully`,
      jsonOutput,
      {
        tips: [
          'Use ' +
            colors.cyan(`rover logs -f ${comparisonTaskId}`) +
            ' to watch the comparison',
          'Use ' +
            colors.cyan(`rover inspect ${comparisonTaskId}`) +
            ' to view comparison results',
        ],
        telemetry,
      }
    );
  } catch (err) {
    comparisonTask.resetToNew();

    jsonOutput.error = `Failed to start comparison task: ${err}`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  await telemetry?.shutdown();
};
