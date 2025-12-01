import { createGetVersion } from 'rover-common';

export const getAgentVersion = createGetVersion({
  moduleUrl: import.meta.url,
  packageJsonPath: '../package.json',
});
