/**
 * Re-export the shared condition evaluator from rover-core.
 * This avoids duplicating the condition evaluation logic between
 * the agent and core packages.
 */
export { evaluateCondition } from 'rover-core';
