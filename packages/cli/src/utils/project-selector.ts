/**
 * Project selector utility for interactive project selection.
 */

import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { ProjectStore, type ProjectManager } from 'rover-core';

const { AutoComplete } = enquirer as unknown as {
  AutoComplete: new (options: {
    name: string;
    message: string;
    limit: number;
    choices: Array<{ name: string; value: string }>;
  }) => {
    run(): Promise<string>;
  };
};

export interface ProjectSelectorChoice {
  name: string;
  value: string;
  repositoryName: string;
  path: string;
}

/**
 * Prompt the user to select a project using an interactive autocomplete selector.
 *
 * @returns The selected ProjectManager, or null if no projects exist or user cancels
 */
export async function promptProjectSelection(): Promise<ProjectManager | null> {
  const store = new ProjectStore();
  const projects = store.list();

  if (projects.length === 0) {
    return null;
  }

  const choices: ProjectSelectorChoice[] = projects.map(p => ({
    name: `${p.repositoryName} ${colors.gray(`(${p.path})`)}`,
    value: p.id,
    repositoryName: p.repositoryName,
    path: p.path,
  }));

  try {
    const prompt = new AutoComplete({
      name: 'project',
      message: 'Select a project',
      limit: 10,
      choices,
    });

    const selectedId = await prompt.run();

    // The AutoComplete returns the name (display string), not the value
    // We need to find the matching choice to get the actual ID
    const selectedChoice = choices.find(c => c.name === selectedId);
    const projectId = selectedChoice?.value ?? selectedId;

    return store.get(projectId) ?? null;
  } catch {
    // User cancelled (Ctrl+C or escape)
    return null;
  }
}
