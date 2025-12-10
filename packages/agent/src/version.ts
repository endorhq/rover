import { createGetVersion } from 'rover-core';

export const getAgentVersion = createGetVersion({
  moduleUrl: import.meta.url,
  packageJsonPath: '../package.json',
});
