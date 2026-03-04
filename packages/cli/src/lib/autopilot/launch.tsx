import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { ProjectManager } from 'rover-core';
import { getVersion } from 'rover-core';
import { AutopilotApp } from './app.js';
import { useTerminalSize } from './hooks/index.js';

// ── Colors (match components.tsx) ──────────────────────────────────────────

const TEAL_600 = '#0d9488';
const TEAL_400 = '#2dd4bf';

// ── Loading steps ──────────────────────────────────────────────────────────

const LOADING_STEPS = [
  'Fetching project context...',
  'Loading previous state...',
  'Connecting to GitHub...',
  'Initializing orchestrator...',
  'Starting dashboard...',
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const STEP_DURATION_MS = 500;
const SPINNER_INTERVAL_MS = 80;

// ── Splash Screen ──────────────────────────────────────────────────────────

function SplashScreen({
  version,
  projectName,
  onComplete,
}: {
  version: string;
  projectName: string;
  onComplete: () => void;
}) {
  const { columns, rows } = useTerminalSize();
  const [stepIndex, setStepIndex] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Advance loading steps, each held for at least STEP_DURATION_MS
  useEffect(() => {
    if (stepIndex >= LOADING_STEPS.length) {
      onComplete();
      return;
    }
    const isLastStep = stepIndex === LOADING_STEPS.length - 1;
    const duration = isLastStep ? 1000 : STEP_DURATION_MS;
    const timer = setTimeout(() => setStepIndex(i => i + 1), duration);
    return () => clearTimeout(timer);
  }, [stepIndex, onComplete]);

  // Spinner animation
  useEffect(() => {
    const timer = setInterval(
      () => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, []);

  if (stepIndex >= LOADING_STEPS.length) return null;

  const message = LOADING_STEPS[stepIndex]!;
  const spinner = SPINNER_FRAMES[spinnerFrame]!;

  // Content: logo (3) + blank (1) + name (1) + project (1) + blank (1) + loading (1) = 8
  const contentHeight = 8;
  const topPad = Math.max(0, Math.floor((rows - contentHeight) / 2));

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={columns}
      alignItems="center"
    >
      <Box height={topPad} />

      {/* Rover logo — wrapped so lines align as a group */}
      <Box flexDirection="column">
        <Text color={TEAL_600}>{' \u256D\u2550\u2550\u2550\u2550\u256E'}</Text>
        <Text>
          <Text color={TEAL_600}>{'\u2759\u2502 '}</Text>
          <Text color={TEAL_400}>{'\u2588\u2588'}</Text>
          <Text color={TEAL_600}>{' \u2502\u2759'}</Text>
        </Text>
        <Text color={TEAL_600}>{' \u2570\u2550\u2550\u2550\u2550\u256F'}</Text>
      </Box>

      <Text> </Text>

      {/* Rover name + version */}
      <Text>
        <Text bold>{'Rover'}</Text>
        <Text dimColor>{' \u00B7 '}</Text>
        <Text dimColor>{`v${version}`}</Text>
      </Text>

      {/* Project name */}
      <Text>
        <Text color="cyan">{'\u25C8 '}</Text>
        <Text color="cyan">{projectName}</Text>
      </Text>

      <Text> </Text>

      {/* Loading spinner + message */}
      <Text>
        <Text color={TEAL_400}>{spinner}</Text>
        <Text dimColor>{` ${message}`}</Text>
      </Text>
    </Box>
  );
}

// ── Launchable App (public wrapper) ────────────────────────────────────────

export function LaunchableApp(props: {
  project: ProjectManager;
  refreshInterval: number;
  fromDate?: Date;
  botName?: string;
  maintainers?: string[];
  allowEvents?: string;
  mode?: string;
}) {
  const [launched, setLaunched] = useState(false);
  const version = getVersion();
  const projectName = props.project.name ?? 'unknown';
  const handleComplete = useCallback(() => setLaunched(true), []);

  if (!launched) {
    return (
      <SplashScreen
        version={version}
        projectName={projectName}
        onComplete={handleComplete}
      />
    );
  }

  return <AutopilotApp {...props} />;
}
