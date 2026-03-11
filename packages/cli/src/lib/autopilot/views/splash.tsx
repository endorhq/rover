import { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { ProjectManager } from 'rover-core';
import { getVersion } from 'rover-core';
import { AutopilotApp } from './dashboard.js';
import { useTerminalSize } from '../hooks/index.js';
import { Logo, TEAL_400 } from '../components/logo.js';

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

  useEffect(() => {
    const timer = setInterval(
      () => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, []);

  if (stepIndex >= LOADING_STEPS.length) return null;

  const message = LOADING_STEPS[stepIndex] ?? '';
  const spinner = SPINNER_FRAMES[spinnerFrame] ?? '';

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

      <Logo />

      <Text> </Text>

      <Text>
        <Text bold>{'Rover'}</Text>
        <Text dimColor>{' · '}</Text>
        <Text dimColor>{`v${version}`}</Text>
      </Text>

      <Text>
        <Text color="cyan">{'◈ '}</Text>
        <Text color="cyan">{projectName}</Text>
      </Text>

      <Text> </Text>

      <Text>
        <Text color={TEAL_400}>{spinner}</Text>
        <Text dimColor>{` ${message}`}</Text>
      </Text>
    </Box>
  );
}

export function LaunchableApp(props: {
  project: ProjectManager;
  mode: string;
  allowEvents: string;
  botName?: string;
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
