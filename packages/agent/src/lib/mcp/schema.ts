import { z } from 'zod';

export const mcpJsonSchema = z.object({
    mcpServers: McpServersSchema.optional(),
});

export const mcpServersSchema = z.record(z.string(), mcpServerSchema);

export const mcpServerSchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
});
