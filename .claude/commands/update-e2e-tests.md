# Update E2E tests

Update the existing end-to-end (e2e) tests across the entire project to match the specifications described in the `E2E_TESTS.md` files. The user also requests the following instructions: "$ARGUMENTS". Ignore if empty.

This command has four phases:

- Discover E2E specifications and existing tests
- Analyze gaps and inconsistencies
- Update tests
- Verify

You must complete all four phases in order.

## Phase: Discover E2E specifications and existing tests

1. Find all `E2E_TESTS.md` files in the project by searching recursively from the project root. Read the root-level `E2E_TESTS.md` first to understand the overall testing philosophy, constraints, and execution methodology.

2. For each `E2E_TESTS.md` file found in a package directory, read it fully and extract:
   - All test suites listed
   - For each suite: preconditions, features, and postconditions
   - Any constraints on test ordering, isolation, or shared state

3. Find all existing e2e test files in the project. Look for:
   - Files matching `**/*.e2e.test.ts`
   - Files inside `**/e2e/**/*.test.ts` directories
   - E2e-specific Vitest/Jest configuration files (e.g., `vitest.e2e.config.ts`)

4. Read all existing e2e test files fully to understand the current test coverage, patterns, helper utilities, and mocking strategies in use.

## Phase: Analyze gaps and inconsistencies

For each package that has an `E2E_TESTS.md` file:

1. Map each test suite and feature described in `E2E_TESTS.md` to existing test files and `describe`/`it` blocks. Build a coverage matrix:
   - Which suites from the spec have corresponding test files?
   - Which features within each suite have corresponding test cases?
   - Which preconditions and postconditions are verified?

2. Identify:
   - **Missing suites**: Test suites described in `E2E_TESTS.md` that have no corresponding test file
   - **Missing features**: Features within a suite that have no corresponding test case
   - **Missing preconditions/postconditions**: Setup or teardown that is described but not implemented
   - **Inconsistencies**: Tests that exist but do not match the current spec (e.g., testing outdated behavior, wrong assertions, missing flags or options)
   - **Structural issues**: Tests that violate the constraints from the root `E2E_TESTS.md` (e.g., tests that depend on execution order, share persistent state between suites)

3. Present a summary to the user showing:
   - The total number of suites and features in the spec
   - How many are currently covered by tests
   - A list of gaps grouped by suite, with a brief description of what is missing
   - Any inconsistencies or structural issues found

4. Ask the user if they want to proceed with updating all identified gaps, or if they want to focus on specific suites or features.
5. <user-input/>

## Phase: Update tests

Apply the changes based on the analysis from the previous phase and the user's selection. Follow these rules strictly:

### General rules

- **Follow existing patterns**: Study the existing e2e test files to understand the code style, helper utilities, mock strategies, and test structure already in use. New and updated tests must be consistent with these patterns.
- **Test isolation**: Every test suite must start from a clean slate. No shared persistent state between suites. Tests within a suite must also be order-independent unless the `E2E_TESTS.md` explicitly states otherwise.
- **Mock only external dependencies**: Mock Docker, AI agents (Claude, Gemini, Codex, Qwen), and other external CLI tools. Use real implementations for core logic like Git operations and file system interactions, following the patterns already established in existing tests.
- **Use real test environments**: Create temporary directories, real Git repositories, and actual project files as the existing tests do.
- **File naming**: E2e test files must follow the `<command>.e2e.test.ts` naming convention and be placed alongside other test files in the `__tests__` directory of the relevant package.
- **Vitest configuration**: Ensure that any new test files match the patterns defined in the existing `vitest.e2e.config.ts` configuration.

### For missing suites

- Create a new test file following the naming convention and location patterns from existing e2e tests.
- Implement all features, preconditions, and postconditions described in the `E2E_TESTS.md` for that suite.
- Reuse existing helper utilities and mock setups wherever possible.

### For missing features within existing suites

- Add new `describe` and `it` blocks in the appropriate existing test file.
- Follow the structure and patterns of adjacent test cases in the same file.

### For inconsistencies

- Update the test assertions, setup, or structure to match the current `E2E_TESTS.md` specification.
- Do **NOT** change the `E2E_TESTS.md` specification. The spec is the source of truth.
- If a test is testing behavior that contradicts the spec, fix the test to match the spec.

### For structural issues

- Refactor tests to eliminate order dependencies or shared state violations.
- Ensure each suite has proper `beforeEach`/`afterEach` or `beforeAll`/`afterAll` hooks for clean setup and teardown.

## Phase: Verify

1. Run the e2e tests for the specific package you updated using the package-level `e2e-test` script (e.g., `pnpm e2e-test` from the package directory) to get faster feedback.

2. If any tests fail:
   - Read the failure output carefully
   - Fix the **test implementation**, not the test expectations (unless the test expectation contradicts the `E2E_TESTS.md` spec)
   - Re-run the tests until they pass

3. Once package-level tests pass, run the full project e2e suite from the project root with `pnpm e2e-test` to ensure nothing is broken across packages.

4. If all tests pass, present a final summary to the user:
   - Number of suites and features added or updated
   - List of new test files created
   - List of existing test files modified
   - Confirmation that all e2e tests pass

5. Run `pnpm format` to ensure all new and modified files follow the project's formatting standards, focusing on files that were changed.
