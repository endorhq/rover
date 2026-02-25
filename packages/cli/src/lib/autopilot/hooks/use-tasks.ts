import { useState, useEffect } from 'react';
import type {
  ProjectManager,
  IterationManager,
  IterationStatusManager,
} from 'rover-core';
import type { TaskInfo } from '../types.js';
import { formatDuration } from '../helpers.js';

const maybeIterationStatus = (
  iteration?: IterationManager
): IterationStatusManager | undefined => {
  try {
    return iteration?.status();
  } catch {
    return undefined;
  }
};

export function useTasks(
  project: ProjectManager,
  refreshInterval: number
): TaskInfo[] {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const allTasks = project.listTasks();
        const infos: TaskInfo[] = [];

        for (const task of allTasks) {
          const lastIteration = task.getLastIteration();
          const iterStatus = maybeIterationStatus(lastIteration);
          const taskStatus = task.status;

          let endTime: string | undefined;
          if (taskStatus === 'FAILED') {
            endTime = task.failedAt;
          } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
            endTime = task.completedAt;
          }

          let agentDisplay = task.agent || '-';
          if (task.agent && task.agentModel) {
            agentDisplay = `${task.agent}:${task.agentModel}`;
          }

          infos.push({
            id: task.id,
            title: task.title || `Task #${task.id}`,
            status: taskStatus,
            progress: iterStatus?.progress ?? 0,
            agent: agentDisplay,
            duration: formatDuration(task.startedAt, endTime),
            iteration: task.iterations,
          });
        }

        setTasks(infos);
      } catch {
        // silently handle
      }
    };

    load();
    const timer = setInterval(load, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [project, refreshInterval]);

  return tasks;
}
