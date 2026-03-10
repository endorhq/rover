import React from 'react';
import { Box, Text } from 'ink';

export interface LegendKey {
  key: string;
  label: string;
}

export const Legend = React.memo(function Legend({
  keys,
}: {
  keys: LegendKey[];
}) {
  return (
    <Box>
      <Text dimColor>
        {'Keys / '}
        {keys
          .map(
            (k, i) => `${k.key}:${k.label}${i < keys.length - 1 ? '  ' : ''}`
          )
          .join('')}
      </Text>
    </Box>
  );
});
