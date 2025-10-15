/**
 * Helper tools to parse the list of options and convert them to
 * { key, value }[] object list.
 *
 * @throws Error when the option does not follow the key=value format
 */
export const parseCollectOptions = (
  options: string[],
  current: Map<string, string>
): Map<string, string> => {
  const kv = new Map(current);

  options.forEach(val => {
    if (!val.includes('=')) {
      throw new Error(
        `The input "${val}" does not follow the key=value format.`
      );
    }

    const split = val.split('=');
    kv.set(split[0], split.slice(1).join('='));
  });

  return kv;
};
