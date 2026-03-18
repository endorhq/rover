You are helping iterate on a software development task. Based on new user instructions and previous iteration context, create a focused title and detailed description for this specific iteration.

%contextSection%

New user instructions for this iteration:
%instructions%

Create a clear, action-oriented title and comprehensive description that:

1. Incorporates the new user instructions
2. Builds upon the previous work (if any)
3. Focuses on what needs to be accomplished in this specific iteration
4. Is specific and actionable

Respond ONLY with valid JSON in this exact format:
{
"title": "Iteration-specific title focusing on the new requirements (max 12 words)",
"description": "Detailed description that explains what needs to be done in this iteration, building on previous work. Include specific steps, requirements, and context from previous iterations. (3-5 sentences)"
}

Examples:

- Instructions: "add error handling to the login form"
  Previous: User login form was implemented
  Response: {"title": "Add comprehensive error handling to login form", "description": "Enhance the existing login form by implementing comprehensive error handling for various failure scenarios. Add validation for network errors, authentication failures, and form validation errors. Display user-friendly error messages and ensure proper error state management. This builds on the previously implemented basic login form functionality."}

- Instructions: "improve the performance of the search feature"
  Previous: Search functionality was added
  Response: {"title": "Optimize search performance and add caching", "description": "Improve the performance of the existing search feature by implementing result caching, debounced input handling, and optimized database queries. Add loading states and pagination to handle large result sets efficiently. This enhancement builds on the previously implemented basic search functionality to provide a better user experience."}
