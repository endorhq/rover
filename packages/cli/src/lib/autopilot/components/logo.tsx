import React from 'react';
import { Box, Text } from 'ink';

const TEAL_600 = '#0d9488';
const TEAL_400 = '#2dd4bf';

export { TEAL_600, TEAL_400 };

export const Logo = React.memo(function Logo({
  rightContent,
}: {
  rightContent?: [React.ReactNode, React.ReactNode, React.ReactNode];
}) {
  if (rightContent) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={TEAL_600}>{' ╭════╮  '}</Text>
          {rightContent[0]}
        </Box>
        <Box>
          <Text color={TEAL_600}>{'❙│ '}</Text>
          <Text color={TEAL_400}>{'██'}</Text>
          <Text color={TEAL_600}>{' │❙ '}</Text>
          {rightContent[1]}
        </Box>
        <Box>
          <Text color={TEAL_600}>{' ╰════╯  '}</Text>
          {rightContent[2]}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={TEAL_600}>{' ╭════╮'}</Text>
      <Text>
        <Text color={TEAL_600}>{'❙│ '}</Text>
        <Text color={TEAL_400}>{'██'}</Text>
        <Text color={TEAL_600}>{' │❙'}</Text>
      </Text>
      <Text color={TEAL_600}>{' ╰════╯'}</Text>
    </Box>
  );
});
