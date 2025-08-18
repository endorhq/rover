import { spawn, spawnSync } from "../os.js";
import { AIAgentTool, InvokeAIAgentError, MissingAIAgentError } from "./index.js";

class GeminiAI implements AIAgentTool {
    // constants
    public AGENT_BIN = 'gemini';

    constructor() {
        // Check docker is available
        try {
            spawnSync(this.AGENT_BIN, ['--version'], { stdio: 'pipe' })
        } catch (err) {
            throw new MissingAIAgentError(this.AGENT_BIN);
        }
    }

    async invoke(prompt: string, json: boolean = false): Promise<string> {
        const geminiArgs = ['-p'];

        if (json) {
            // Gemini does not have any way to force the JSON output at CLI level.
            // Trying to force it via prompting
            prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
        }

        try {
            const { stdout } = await spawn(this.AGENT_BIN, geminiArgs, {
                input: prompt,
            });
            return stdout.toString().trim();
        } catch (error) {
            throw new InvokeAIAgentError(this.AGENT_BIN, error);
        }
    }
}

export default GeminiAI;