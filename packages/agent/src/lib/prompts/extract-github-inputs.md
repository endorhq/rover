You are tasked with extracting specific workflow input values from a GitHub issue description.

**GitHub Issue Description:**
%issueDescription%

**Required Workflow Inputs:**
%inputsMetadata%

**Task:**
Analyze the GitHub issue description above and extract the values for each required workflow input. Use the input descriptions and labels as hints for what to look for in the issue text.

**Instructions:**

- Extract the most relevant information from the issue description for each required input
- If a value is clearly stated in the issue, use it exactly
- If a value needs to be inferred from context, make a reasonable interpretation
- For boolean inputs, infer true/false based on the issue content
- For number inputs, extract or infer numeric values
- If an input value cannot be found or reasonably inferred, use null

Respond ONLY with valid JSON in this exact format:
{
"input_name_1": "extracted value",
"input_name_2": "extracted value",
...
}

Examples:

**Example 1:**
Issue Description: "The login form needs better error handling. Users should see clear messages when they enter invalid credentials. The error messages should be displayed in red text above the form."

Required Inputs:

- feature: (string) The feature or component to modify
- improvement: (string) Description of the improvement needed

Response: {"feature": "login form", "improvement": "Add better error handling with clear messages displayed in red text above the form when users enter invalid credentials"}

**Example 2:**
Issue Description: "We need to optimize database queries in the user service. Current response time is around 2 seconds, we want to reduce it to under 500ms."

Required Inputs:

- component: (string) The component to optimize
- target_time_ms: (number) Target response time in milliseconds
- critical: (boolean) Whether this is a critical issue

Response: {"component": "user service database queries", "target_time_ms": 500, "critical": true}
