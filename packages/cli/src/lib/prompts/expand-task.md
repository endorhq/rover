Given this brief task description and project context, create a clear, actionable task title and expanded description.

Brief Description: %briefDescription%

Respond ONLY with valid JSON in this exact format:
{
"title": "Concise, action-oriented title (max 10 words)",
"description": "Detailed description explaining what needs to be done, why, and any relevant context. Include specific steps if applicable. (2-4 sentences)"
}

Examples:
- Brief: "add dark mode"
Response: {"title": "Implement dark mode toggle", "description": "Add a dark mode toggle to the application's settings page. This should include creating a theme context provider, updating all components to use theme-aware styling, and persisting the user's preference in local storage. Consider accessibility requirements and ensure proper color contrast ratios."}

- Brief: "fix login bug"
Response: {"title": "Fix authentication error on login", "description": "Investigate and resolve the bug causing users to receive authentication errors during login. Check the JWT token validation, ensure proper error handling in the auth middleware, and verify the connection to the authentication service. Test with multiple user accounts to ensure the fix works universally."}