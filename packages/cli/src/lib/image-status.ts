/**
 * Image Status - Utility for detecting custom image updates
 *
 * This module provides functionality to check if a custom Docker image
 * needs to be rebuilt due to changes in the base image or project configuration.
 */

import crypto from 'node:crypto';
import { ProjectConfigManager } from 'rover-core';
import { getDefaultAgentImage } from './sandbox/container-common.js';
import {
  getLanguagePackages,
  getPackageManagerPackages,
  getTaskManagerPackages,
} from './dockerfile-builder.js';

export type ImageStatusResult = 'none' | 'up-to-date' | 'outdated';

export interface ImageStatus {
  /** Overall status of the custom image */
  status: ImageStatusResult;
  /** List of issues that make the image outdated */
  issues?: string[];
  /** Current default base image */
  currentBaseImage?: string;
  /** Base image used when the custom image was generated */
  generatedBaseImage?: string;
  /** ISO timestamp when the custom image was generated */
  generatedAt?: string;
  /** Current packages hash */
  currentPackagesHash?: string;
  /** Packages hash from when the image was generated */
  generatedPackagesHash?: string;
}

/**
 * Compute a hash of all detected packages for change detection
 *
 * This hash is used to detect when the project configuration has changed
 * and the custom image needs to be rebuilt.
 */
export function computePackagesHash(
  projectConfig: ProjectConfigManager
): string {
  const packages = [
    ...getLanguagePackages(projectConfig).map(p => p.name),
    ...getPackageManagerPackages(projectConfig).map(p => p.name),
    ...getTaskManagerPackages(projectConfig).map(p => p.name),
  ].sort();

  return crypto
    .createHash('sha256')
    .update(packages.join(','))
    .digest('hex')
    .slice(0, 8);
}

/**
 * Check the status of a custom image configuration
 *
 * Returns information about whether the custom image is up-to-date,
 * outdated, or not configured.
 */
export function checkImageStatus(
  projectConfig: ProjectConfigManager
): ImageStatus {
  const generatedFrom = projectConfig.generatedFrom;

  // No custom image configured
  if (!generatedFrom || !projectConfig.agentImage) {
    return {
      status: 'none',
    };
  }

  const issues: string[] = [];
  const currentBaseImage = getDefaultAgentImage();
  const currentPackagesHash = computePackagesHash(projectConfig);

  // Check if base image has changed
  if (generatedFrom.baseImage !== currentBaseImage) {
    issues.push(`Base image update available: ${currentBaseImage}`);
  }

  // Check if packages have changed
  if (generatedFrom.packagesHash !== currentPackagesHash) {
    issues.push('Project configuration changed (detected packages differ)');
  }

  return {
    status: issues.length > 0 ? 'outdated' : 'up-to-date',
    issues: issues.length > 0 ? issues : undefined,
    currentBaseImage,
    generatedBaseImage: generatedFrom.baseImage,
    generatedAt: generatedFrom.generatedAt,
    currentPackagesHash,
    generatedPackagesHash: generatedFrom.packagesHash,
  };
}

/**
 * Format the image status for human-readable output
 */
export function formatImageStatus(status: ImageStatus): string {
  const lines: string[] = [];

  if (status.status === 'none') {
    lines.push('No custom image configured');
    lines.push('');
    lines.push('Run `rover image build` to generate a custom image');
    return lines.join('\n');
  }

  lines.push(`Base image:   ${status.generatedBaseImage}`);

  if (status.generatedAt) {
    const date = new Date(status.generatedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let ago: string;
    if (diffDays === 0) {
      ago = 'today';
    } else if (diffDays === 1) {
      ago = 'yesterday';
    } else if (diffDays < 7) {
      ago = `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      ago = weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      ago = months === 1 ? '1 month ago' : `${months} months ago`;
    }

    lines.push(`Generated:    ${ago} (${date.toISOString().split('T')[0]})`);
  }

  lines.push('');

  if (status.status === 'up-to-date') {
    lines.push('Status: Up to date');
  } else if (status.status === 'outdated') {
    lines.push('Status: Outdated');
    if (status.issues) {
      for (const issue of status.issues) {
        lines.push(`  - ${issue}`);
      }
    }
    lines.push('');
    lines.push('Run `rover image rebuild` to update');
  }

  return lines.join('\n');
}
