interface InstallCommandOptions {}

/**
 * Install required tools to run an Agent workflow file. If the argument do not include
 * any specific tool, it will go through all the steps and will all required tools.
 */
export const installCommand = async (
  workflowPath: string,
  options: InstallCommandOptions = {}
) => {};
