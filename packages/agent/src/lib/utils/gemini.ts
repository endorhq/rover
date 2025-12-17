/**
 * Detects whether the provided text contains the Gemini YOLO warning.
 *
 * Gemini CLI prints a warning similar to:
 *   "YOLO mode is enabled. All tool calls will be automatically approved."
 * when global auto approve is turned on. This warning is informational and
 * should not cause Rover workflows to fail.
 */
export function containsGeminiYoloWarning(text: string | undefined | null) {
  if (!text) {
    return false;
  }

  const normalized = text.toLowerCase();

  return (
    normalized.includes('yolo mode is enabled') ||
    normalized.includes('all tool calls will be automatically approved') ||
    normalized.includes('global auto approve')
  );
}
