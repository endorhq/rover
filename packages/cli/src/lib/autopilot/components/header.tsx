import React from 'react';
import { Box, Text } from 'ink';
import { Logo } from './logo.js';

export const Header = React.memo(function Header({
  version,
  agent,
  projectName,
  coordinatorActive,
  workflowActive,
  resolverActive,
}: {
  version: string;
  agent: string;
  projectName: string;
  coordinatorActive: boolean;
  workflowActive: boolean;
  resolverActive: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Box>
        <Logo
          rightContent={[
            <Text key="version">
              <Text bold>{'Rover '}</Text>
              <Text dimColor>{'· '}</Text>
              <Text dimColor>{`v${version}`}</Text>
            </Text>,
            <Text key="agent">{agent}</Text>,
            <Text key="project">
              <Text color="cyan">{'◈ '}</Text>
              <Text color="cyan">{projectName}</Text>
            </Text>,
          ]}
        />
        <Box flexGrow={1} />
        {/* Right: status box */}
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text>{'status '}</Text>
          <Text color={coordinatorActive ? 'cyan' : 'gray'}>
            {coordinatorActive ? '●' : '○'}
          </Text>
          <Text> </Text>
          <Text color={workflowActive ? 'blue' : 'gray'}>
            {workflowActive ? '●' : '○'}
          </Text>
          <Text> </Text>
          <Text color={resolverActive ? 'yellow' : 'gray'}>
            {resolverActive ? '●' : '○'}
          </Text>
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  );
});
