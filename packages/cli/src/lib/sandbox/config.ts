import { launch } from 'rover-core';
import { existsSync } from 'node:fs';

/**
 * Security level for sandbox execution.
 * - standard: Docker/Podman with shared kernel (fastest, least isolation)
 * - enhanced: Docker/Podman with gVisor runtime (syscall filtering)
 * - maximum: Firecracker microVM (full kernel isolation, Linux/KVM only)
 */
export type SecurityLevel = 'standard' | 'enhanced' | 'maximum';

/**
 * Network isolation mode for sandbox containers.
 * - none: No network access (most secure)
 * - restricted: Only allowed API endpoints (Claude, Gemini, etc.)
 * - full: Full network access (current default behavior)
 */
export type NetworkMode = 'none' | 'restricted' | 'full';

/**
 * Resource limits for sandbox containers.
 */
export interface ResourceLimits {
  /** Memory limit (e.g., '4g', '512m') */
  memory?: string;
  /** CPU limit (e.g., '2', '0.5') */
  cpus?: string;
  /** Maximum number of processes */
  pidsLimit?: number;
}

/**
 * Sandbox configuration options.
 */
export interface SandboxConfig {
  /** Security level (standard, enhanced, maximum) */
  securityLevel: SecurityLevel;
  /** Network isolation mode */
  networkMode: NetworkMode;
  /** Resource limits */
  resources: ResourceLimits;
  /** Force specific backend (overrides auto-detection) */
  forceBackend?: 'docker' | 'podman' | 'gvisor' | 'firecracker';
}

/**
 * Default sandbox configuration values.
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  securityLevel: 'standard',
  networkMode: 'full',
  resources: {
    memory: '4g',
    cpus: '2',
    pidsLimit: 256,
  },
};

/**
 * Allowed API endpoints for restricted network mode.
 * These are the hosts that AI agents need to communicate with.
 */
export const ALLOWED_API_HOSTS = [
  // Anthropic (Claude)
  'api.anthropic.com',
  'api.claude.ai',
  // AWS Bedrock
  'bedrock-runtime.*.amazonaws.com',
  'bedrock.*.amazonaws.com',
  // Google (Gemini/Vertex AI)
  'generativelanguage.googleapis.com',
  '*.aiplatform.googleapis.com',
  'oauth2.googleapis.com',
  // OpenAI (for Codex/compatible)
  'api.openai.com',
  // Azure OpenAI
  '*.openai.azure.com',
  // Package registries (for agent setup)
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
];

/**
 * Load sandbox configuration from environment variables.
 */
export function loadSandboxConfig(): SandboxConfig {
  const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG };

  // Security level
  const securityLevel = process.env.ROVER_SECURITY_LEVEL;
  if (
    securityLevel === 'standard' ||
    securityLevel === 'enhanced' ||
    securityLevel === 'maximum'
  ) {
    config.securityLevel = securityLevel;
  }

  // Network mode
  const networkMode = process.env.ROVER_NETWORK_MODE;
  if (
    networkMode === 'none' ||
    networkMode === 'restricted' ||
    networkMode === 'full'
  ) {
    config.networkMode = networkMode;
  }

  // Resource limits
  if (process.env.ROVER_MEMORY_LIMIT) {
    config.resources.memory = process.env.ROVER_MEMORY_LIMIT;
  }
  if (process.env.ROVER_CPU_LIMIT) {
    config.resources.cpus = process.env.ROVER_CPU_LIMIT;
  }
  if (process.env.ROVER_PIDS_LIMIT) {
    const pidsLimit = parseInt(process.env.ROVER_PIDS_LIMIT, 10);
    if (!isNaN(pidsLimit) && pidsLimit > 0) {
      config.resources.pidsLimit = pidsLimit;
    }
  }

  // Force backend
  const forceBackend = process.env.ROVER_SANDBOX_BACKEND;
  if (
    forceBackend === 'docker' ||
    forceBackend === 'podman' ||
    forceBackend === 'gvisor' ||
    forceBackend === 'firecracker'
  ) {
    config.forceBackend = forceBackend;
  }

  // Legacy gVisor env var support
  if (process.env.ROVER_USE_GVISOR === 'true' && !config.forceBackend) {
    config.securityLevel = 'enhanced';
  }

  return config;
}

/**
 * Check if gVisor runtime (runsc) is available in Docker.
 * gVisor provides user-space syscall interception for enhanced isolation.
 */
export async function isGVisorAvailable(): Promise<boolean> {
  try {
    const result = await launch('docker', [
      'info',
      '--format',
      '{{json .Runtimes}}',
    ]);
    const runtimesJson = result.stdout?.toString().trim() || '{}';
    const runtimes = JSON.parse(runtimesJson);

    // Check if runsc (gVisor) is in the available runtimes
    return 'runsc' in runtimes;
  } catch {
    return false;
  }
}

/**
 * Check if KVM is available for Firecracker microVMs.
 * This requires Linux with KVM support.
 */
export async function isKVMAvailable(): Promise<boolean> {
  // KVM is only available on Linux
  if (process.platform !== 'linux') {
    return false;
  }

  // Check if /dev/kvm exists and is accessible
  if (!existsSync('/dev/kvm')) {
    return false;
  }

  // Try to check if we can access /dev/kvm
  try {
    const result = await launch('test', [
      '-r',
      '/dev/kvm',
      '-a',
      '-w',
      '/dev/kvm',
    ]);
    return result.exitCode === 0;
  } catch {
    // Fallback: just check existence
    return existsSync('/dev/kvm');
  }
}

/**
 * Check if Firecracker binary is available.
 */
export async function isFirecrackerAvailable(): Promise<boolean> {
  try {
    await launch('firecracker', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine the best available security level based on system capabilities.
 */
export async function detectBestSecurityLevel(): Promise<SecurityLevel> {
  // Check for Firecracker/KVM (maximum security)
  if ((await isKVMAvailable()) && (await isFirecrackerAvailable())) {
    return 'maximum';
  }

  // Check for gVisor (enhanced security)
  if (await isGVisorAvailable()) {
    return 'enhanced';
  }

  // Default to standard Docker
  return 'standard';
}

/**
 * Get Docker/Podman arguments for resource limits.
 */
export function getResourceLimitArgs(resources: ResourceLimits): string[] {
  const args: string[] = [];

  if (resources.memory) {
    args.push('--memory', resources.memory);
  }

  if (resources.cpus) {
    args.push('--cpus', resources.cpus);
  }

  if (resources.pidsLimit) {
    args.push('--pids-limit', resources.pidsLimit.toString());
  }

  return args;
}

/**
 * Get Docker/Podman arguments for network isolation.
 */
export function getNetworkArgs(networkMode: NetworkMode): string[] {
  switch (networkMode) {
    case 'none':
      return ['--network', 'none'];
    case 'restricted':
      // For restricted mode, we use bridge network but can add
      // host-specific restrictions via iptables in the entrypoint
      // Note: Full iptables-based restriction requires additional setup
      return ['--network', 'bridge'];
    case 'full':
    default:
      // Default Docker networking (bridge)
      return [];
  }
}

/**
 * Get Docker arguments for gVisor runtime.
 */
export function getGVisorRuntimeArgs(useGVisor: boolean): string[] {
  if (useGVisor) {
    return ['--runtime', 'runsc'];
  }
  return [];
}
