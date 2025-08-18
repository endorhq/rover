export class JsonParseError extends Error {
    constructor(message: string, public originalResponse: string) {
        super(message);
        this.name = 'JsonParseError';
    }
}

/**
 * Parse JSON response from AI, handling common formatting issues
 * @param response The raw response from the AI
 * @returns The parsed JSON object
 * @throws JsonParseError if parsing fails
 */
export function parseJsonResponse<T>(response: string): T {
    if (!response) {
        throw new JsonParseError('Empty response received', response);
    }

    let cleanedResponse = response.trim();
    
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '');
    cleanedResponse = cleanedResponse.replace(/^```\s*/i, '');
    cleanedResponse = cleanedResponse.replace(/\s*```$/i, '');
    
    // Try to extract JSON from the response
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new JsonParseError('No JSON object found in response', response);
    }
    
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed as T;
    } catch (error) {
        throw new JsonParseError(
            `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
            response
        );
    }
}