import { z } from 'zod';

// Stdio MCP server schema (local process)
export const mcpStdioServerSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});

// SSE MCP server schema (Server-Sent Events)
export const mcpSseServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});

// Streamable HTTP MCP server schema
export const mcpStreamableHttpServerSchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});

// Legacy remote server schema (backward compatibility - identified by presence of 'url' without 'type')
export const mcpRemoteServerSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});

// Legacy stdio server schema (backward compatibility - identified by presence of 'command' without 'type')
export const mcpLegacyStdioServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().optional(),
});

// Union of all server types
export const mcpServerSchema = z.union([
  mcpStdioServerSchema,
  mcpSseServerSchema,
  mcpStreamableHttpServerSchema,
  mcpRemoteServerSchema,
  mcpLegacyStdioServerSchema,
]);

export const mcpServersSchema = z.record(z.string(), mcpServerSchema);

export const mcpJsonSchema = z.object({
  mcpServers: mcpServersSchema.optional(),
});
