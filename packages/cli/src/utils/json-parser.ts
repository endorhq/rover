/**
 * Re-export JSON parsing utilities from the agent package.
 *
 * The canonical implementation now lives in @endorhq/agent.
 * This module re-exports everything for backwards compatibility
 * with existing CLI imports.
 */
export { parseJsonResponse, JsonParseError } from '@endorhq/agent';
