/**
 * Network configuration utilities for container sandboxes.
 * Handles generation of iptables rules for network filtering.
 */

import type { NetworkConfig, NetworkRule } from 'rover-schemas';

/**
 * Merge network configurations from project and task levels.
 * Task-level config takes full precedence over project-level config.
 */
export function mergeNetworkConfig(
  projectConfig?: NetworkConfig,
  taskConfig?: NetworkConfig
): NetworkConfig | undefined {
  // Task config takes full precedence
  if (taskConfig) {
    return taskConfig;
  }

  // Fall back to project config
  return projectConfig;
}

/**
 * Check if a string is a valid IPv4 address.
 */
function isIPv4(host: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  return ipv4Regex.test(host);
}

/**
 * Check if a string is a valid IPv6 address.
 */
function isIPv6(host: string): boolean {
  // Simple check for IPv6 - contains colons
  return host.includes(':') && !host.includes('://');
}

/**
 * Check if a string is an IP address or CIDR notation.
 */
function isIPOrCIDR(host: string): boolean {
  return isIPv4(host) || isIPv6(host);
}

/**
 * Generate the bash script section for network filtering.
 * Returns empty string if network filtering is disabled.
 */
export function generateNetworkScript(
  config: NetworkConfig | undefined
): string {
  if (!config || config.mode === 'none') {
    return '';
  }

  const lines: string[] = [
    '',
    '# ========================================',
    '# Network Filtering Configuration',
    '# ========================================',
    '',
    'configure_network_filtering() {',
    `  local mode="${config.mode}"`,
    '',
    '  echo "Configuring network filtering (mode: $mode)"',
    '',
    '  # Install iptables if not available (Alpine Linux)',
    '  if ! command -v iptables &> /dev/null; then',
    '    echo "Installing iptables..."',
    '    sudo apk add --no-cache iptables ip6tables &> /dev/null || true',
    '  fi',
    '',
    '  # Function to resolve hostname to IPs',
    '  resolve_host() {',
    '    local host="$1"',
    '    # Check if already an IP or CIDR',
    '    if [[ "$host" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+(/[0-9]+)?$ ]] || [[ "$host" =~ : ]]; then',
    '      echo "$host"',
    '      return',
    '    fi',
    '    # Resolve domain to IPs',
    '    getent hosts "$host" 2>/dev/null | awk \'{print $1}\' | sort -u',
    '  }',
    '',
  ];

  if (config.mode === 'allowlist') {
    lines.push(...generateAllowlistScript(config));
  } else if (config.mode === 'blocklist') {
    lines.push(...generateBlocklistScript(config));
  }

  lines.push(
    '',
    '  echo "Network filtering configured successfully"',
    '}',
    '',
    '# Apply network filtering',
    'configure_network_filtering',
    ''
  );

  return lines.join('\n');
}

/**
 * Generate iptables rules for allowlist mode (deny all except listed).
 */
function generateAllowlistScript(config: NetworkConfig): string[] {
  const lines: string[] = [
    '  # Allowlist mode: Block all traffic except explicitly allowed',
    '',
    '  # Set default policy to drop all outgoing traffic',
    '  sudo iptables -P OUTPUT DROP 2>/dev/null || true',
    '  sudo ip6tables -P OUTPUT DROP 2>/dev/null || true',
    '',
    '  # Allow established connections (for responses to our requests)',
    '  sudo iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true',
    '  sudo ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true',
    '',
  ];

  if (config.allowLocalhost !== false) {
    lines.push(
      '  # Allow localhost/loopback traffic',
      '  sudo iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true',
      '  sudo ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true',
      ''
    );
  }

  if (config.allowDns !== false) {
    lines.push(
      '  # Allow DNS resolution',
      '  sudo iptables -A OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || true',
      '  sudo iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null || true',
      '  sudo ip6tables -A OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || true',
      '  sudo ip6tables -A OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null || true',
      ''
    );
  }

  // Add rules for each allowed host
  if (config.rules && config.rules.length > 0) {
    lines.push('  # Allow specific hosts');
    for (const rule of config.rules) {
      const comment = rule.description ? ` # ${rule.description}` : '';
      if (isIPOrCIDR(rule.host)) {
        // Direct IP/CIDR - no resolution needed
        if (isIPv6(rule.host)) {
          lines.push(
            `  sudo ip6tables -A OUTPUT -d ${rule.host} -j ACCEPT 2>/dev/null || true${comment}`
          );
        } else {
          lines.push(
            `  sudo iptables -A OUTPUT -d ${rule.host} -j ACCEPT 2>/dev/null || true${comment}`
          );
        }
      } else {
        // Domain - needs resolution
        lines.push(`  # ${rule.host}${comment}`);
        lines.push(`  for ip in $(resolve_host "${rule.host}"); do`);
        lines.push('    if [[ "$ip" =~ : ]]; then');
        lines.push(
          '      sudo ip6tables -A OUTPUT -d "$ip" -j ACCEPT 2>/dev/null || true'
        );
        lines.push('    else');
        lines.push(
          '      sudo iptables -A OUTPUT -d "$ip" -j ACCEPT 2>/dev/null || true'
        );
        lines.push('    fi');
        lines.push('  done');
      }
    }
  }

  return lines;
}

/**
 * Generate iptables rules for blocklist mode (allow all except listed).
 */
function generateBlocklistScript(config: NetworkConfig): string[] {
  const lines: string[] = [
    '  # Blocklist mode: Allow all traffic except explicitly blocked',
    '',
  ];

  // Add rules for each blocked host
  if (config.rules && config.rules.length > 0) {
    lines.push('  # Block specific hosts');
    for (const rule of config.rules) {
      const comment = rule.description ? ` # ${rule.description}` : '';
      if (isIPOrCIDR(rule.host)) {
        // Direct IP/CIDR - no resolution needed
        if (isIPv6(rule.host)) {
          lines.push(
            `  sudo ip6tables -A OUTPUT -d ${rule.host} -j DROP 2>/dev/null || true${comment}`
          );
        } else {
          lines.push(
            `  sudo iptables -A OUTPUT -d ${rule.host} -j DROP 2>/dev/null || true${comment}`
          );
        }
      } else {
        // Domain - needs resolution
        lines.push(`  # ${rule.host}${comment}`);
        lines.push(`  for ip in $(resolve_host "${rule.host}"); do`);
        lines.push('    if [[ "$ip" =~ : ]]; then');
        lines.push(
          '      sudo ip6tables -A OUTPUT -d "$ip" -j DROP 2>/dev/null || true'
        );
        lines.push('    else');
        lines.push(
          '      sudo iptables -A OUTPUT -d "$ip" -j DROP 2>/dev/null || true'
        );
        lines.push('    fi');
        lines.push('  done');
      }
    }
  }

  return lines;
}

/**
 * Validation result for network rules.
 */
export interface NetworkRuleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate network rules for correctness.
 */
export function validateNetworkRules(
  rules: NetworkRule[]
): NetworkRuleValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    if (!rule.host || rule.host.trim().length === 0) {
      errors.push('Empty host in network rule');
      continue;
    }

    const host = rule.host.trim();

    // Check for invalid characters
    if (/[<>"|?*]/.test(host)) {
      errors.push(`Invalid characters in host: ${host}`);
      continue;
    }

    // Validate CIDR notation if present
    if (host.includes('/')) {
      const parts = host.split('/');
      if (parts.length !== 2) {
        errors.push(`Invalid CIDR notation: ${host}`);
        continue;
      }

      const prefix = parseInt(parts[1], 10);
      if (isNaN(prefix)) {
        errors.push(`Invalid CIDR prefix: ${host}`);
        continue;
      }

      // IPv4 prefix should be 0-32, IPv6 prefix should be 0-128
      const isV6 = host.includes(':');
      const maxPrefix = isV6 ? 128 : 32;
      if (prefix < 0 || prefix > maxPrefix) {
        errors.push(`CIDR prefix out of range: ${host}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
