import { Box, useInput, useApp } from 'ink';
import type { ProjectManager } from 'rover-core';
import { getVersion } from 'rover-core';
import { Header, Legend } from '../components/index.js';
import { useTerminalSize } from '../hooks/index.js';
import { getUserAIAgent } from '../../agents/index.js';

export function AutopilotApp({
  project,
}: {
  project: ProjectManager;
  mode: string;
  allowEvents: string;
}) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  const projectName = project.name ?? 'unknown';
  const agent = getUserAIAgent();
  const version = getVersion();

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Header
        version={version}
        agent={agent}
        projectName={projectName}
        coordinatorActive={false}
        workflowActive={false}
        resolverActive={false}
      />

      <Box flexGrow={1} />

      <Legend
        keys={[
          { key: 'i', label: 'inspector' },
          { key: 'q', label: 'quit' },
        ]}
      />
    </Box>
  );
}
