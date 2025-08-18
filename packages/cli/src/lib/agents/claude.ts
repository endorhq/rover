import { spawn, spawnSync } from "../os.js";
import { AIAgentTool, InvokeAIAgentError, MissingAIAgentError } from "./index.js";

class ClaudeAI implements AIAgentTool {
    // constants
    public AGENT_BIN = 'claude';

    constructor() {
        // Check docker is available
        try {
            spawnSync(this.AGENT_BIN, ['--version'], { stdio: 'pipe' })
        } catch (err) {
            throw new MissingAIAgentError(this.AGENT_BIN);
        }
    }

    async invoke(prompt: string, json: boolean = false): Promise<string> {
        const claudeArgs = ['-p'];

        if (json) {
            claudeArgs.push('--output-format');
            claudeArgs.push('json');
        }

        try {
            const { stdout } = await spawn(this.AGENT_BIN, claudeArgs, {
                input: prompt,
                env: {
                    ...process.env,
                    // Ensure non-interactive mode
                    CLAUDE_NON_INTERACTIVE: 'true'
                },
            });
            return stdout.toString().trim();
        } catch (error) {
            throw new InvokeAIAgentError(this.AGENT_BIN, error);
        }
    }
}

export default ClaudeAI;