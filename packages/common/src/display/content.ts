import boxen from 'boxen';

/**
 * Display a file content
 *
 * Example output:
 * ```
 * ┌ context.md ─────┐
 * │ foo bar foo bar │
 * └─────────────────┘
 * ```
 *
 * @param filename - The file name
 * @param content - The full file content
 */
export const showFile = (filename: string, content: string): void => {
  const contentToDisplay = content.length === 0 ? '-' : content;
  console.log(
    boxen(contentToDisplay, {
      title: filename,
      borderColor: 'gray',
      padding: 1,
    })
  );
};
