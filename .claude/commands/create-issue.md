# Create a new GitHub issue

Create a new GitHub issue in the current repository. This command is a process, so you must go through all the steps and wait for user input when required. You can clearly identify when you must wait for user input based on the <user-input/> template. This is very important.

This command has three phases:

- Get user requirements and task description
- Identify the task context
- Create the issue

You must complete the three phases in order.

## Phase: Get user requirements and task description

1. Ask the user to briefly describe the task they want to accomplish.
2. <user-input/>
3. Based on the user input and your current understanding of the project (from Claude.md and any other file you consider), provide an expanded and more complete 1–2 paragraphs about the scope and the end goal of the task. Max 250 characters.

    <good-example>
    User input:

    update the website dark palette to use cyan as the base color instead of green.

    Expanded task description:

    Update the website’s dark color palette by switching the base color from green (previously defined in app.css) to cyan. Make sure the updated palette maintains enough contrast to comply with accessibility standards.
    </good-example>

    <bad-example>
    User input:

    update the website dark palette to use cyan as the base color instead of green.

    Expanded task description:

    Update the website palette to cyan.
    </bad-example>

    <bad-example>
    User input:

    update the website dark palette to use cyan as the base color instead of green.

    Expanded task description:

    The goal of this task is to update the website’s dark theme color palette so that it reflects a new branding direction. At the moment, in the app.css file, the primary color that is defined is a shade that is close to green, which has been used as the base color for some time.

    However, the design team has decided to move away from this greenish hue and instead adopt cyan as the foundation for the new color palette. As part of this task, you will need to replace the previous references to the green-based primary color with the new cyan-based palette across the dark theme styles.
    </bad-example>
4. Ask the user if this task description is good enough or if they want to add more details or change anything.
5. <user-input/>
6. If the user accepts the task description, you can finish this phase. If not, ask the user to provide more instructions (<user-input/>) and go back to step 3.

Now, you have an expanded description and successfully collected all the required information to create the issue.

Go to the next phase.

## Phase: Identify the task context

Based on the information from the previous phase, check the project to:

- Identify potential files that will be affected by this task
- Find patterns, libraries, specific methods, or any other part of the code that could be relevant for this task

Once you have all this information, go to the next phase.

## Phase: Create the issue

Create a new GitHub issue based on the information from the previous phases. Follow these rules to create the issue content:

1. Use a clear and concise title that summarizes the issue’s main goal

    <good-example>
    Update the primary dark color to cyan
    Update the dark palette to use cyan as primary color
    </good-example>

    <bad-example>
    Update the dark palette
    Update the dark palette to use cyan as primary color following the requirements from the design team.
    </bad-example>

2. The issue body must be informative, clear, and concise. Use neutral language that explains the issue description and scope, so users can quickly identify the requirements and tasks to be done.

3. Do not include any "Created by Claude" comment at the end.

4. Add a checklist to split the task into smaller items to be completed. These items will help developers or agents fully complete the task more efficiently.

5. Use GitHub markdown format in the body. For example, use code blocks to show pieces of code, inline code blocks to highlight methods in paragraphs and list items, mermaid diagrams for complex pull requests, and tables when required.

6. Follow this template:

    <template>
    Brief summary of the task description, goals, and the scope. Max 2 paragraphs and 450 characters.

    <good-example>
    Update the dark theme color scheme by changing the primary color from green to cyan. This change should be applied consistently across all components that rely on the dark palette, including buttons, links, and background highlights.

    The goal is to align the design system with the updated branding guidelines while ensuring readability and accessibility compliance remain intact.
    </good-example>

    <good-example>
    Refactor the authentication module to use the new token-based API instead of the deprecated session-based system. This will affect the login, logout, and token refresh logic.

    The goal is to make authentication more secure and future-proof while reducing reliance on legacy endpoints that may be removed in upcoming releases.
    </good-example>

    <bad-example>
    Change colors in the dark theme.
    </bad-example>

    <bad-example>
    Update the authentication system to be more modern and better.
    </bad-example>

    # Details

    An optional section to indicate any technical details about how to implement this task, out-of-scope changes, or any other relevant information. Max 450 characters between paragraphs and lists.

    You can also include a mermaid diagram if the task is too complex and a diagram might help to understand it. The maximum number of characters does not apply to the mermaid diagram.

    Skip this section when the change is simple or trivial.

    <good-example>
    The color palette is currently defined in `styles/app.css`. Look for the `--primary-dark` variable and update its value to cyan (`#00bcd4`). Ensure the change propagates correctly by checking the usage in components such as `Button`, `Navbar`, and `Card`.

    Accessibility should be verified with a contrast checker to ensure that text on cyan backgrounds remains legible.
    </good-example>

    <good-example>
    The current authentication logic is located in `src/auth/index.ts`. Replace the session handling code with API calls to `/api/token` for login and `/api/token/refresh` for extending session validity.

    Do not update unrelated services such as password reset or email confirmation flows, as those will be handled in a separate issue.
    </good-example>

    <bad-example>
    Change the color in the CSS file.
    </bad-example>

    <bad-example>
    Make the login system better.
    </bad-example>

    # TODO

    A checklist with 1–3 items that splits the current task description into smaller items. Be concise here about the changes and include specific filenames if you consider it.

    <good-example>
    - [ ] Update `--primary-dark` in `styles/app.css` to cyan
    - [ ] Verify usage across components (`Button`, `Navbar`, `Card`)
    - [ ] Run accessibility contrast tests
    </good-example>

    <good-example>
    - [ ] Replace session handling in `src/auth/index.ts` with token-based logic
    - [ ] Add token refresh flow using `/api/token/refresh`
    - [ ] Test login/logout flow in staging
    </good-example>

    <bad-example>
    - [ ] Update the theme
    </bad-example>

    <bad-example>
    - [ ] Fix authentication
    </bad-example>
    </template>

7. Use the `gh` CLI to create the issue
