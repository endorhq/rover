# End to end testing (e2e testing)

Maintain a set of End-To-End (e2e) tests for this project.

These tests must ensure that the functional requirements are met. Tests
are organized in test suites. A Test suite is responsible for testing
a specific Rover feature. Within a test suite, multiple tests might be
run to ensure that a certain feature is working as expected.

Tests **MUST NOT** rely on order of execution. They can be shuffled
at all times and are expected to behave in the same way. Every test
suite starts from a clean slate, it cannot share any persistent state
with other test suites. Unless stated otherwise, tests within a test
suite are also order independent and they **MUST NOT** require a
certain state of the system set by other tests.

Tests **MUST NOT** rely on system state that is not previously set up
by any before/after test code. Tests **MUST** clean up after
themselves all temporary state they have created in order to run
tests, regardless of the outcome of the test result.

In general, and unless otherwise explicitly mentioned on the test
description, tests **SHOULD** use fixtures for agent
communication. However, on certain tests, it might be explicitly noted
that a production agent must be used; in that case it's **FORBIDDEN**
to perform any kind of fixture usage, doubling or mocking.

**BE EXPLICIT** at the header and bottom of **EACH** e2e test that is
maintained by this automation, mentioning that these files **SHOULD
NOT** be manually modified. Mention what `E2E_TESTS.md` file or files
should be modified in order to have an impact on the generated code.

## Tests location

Every package conforming Rover **MIGHT** have its own e2e tests. You
should make sure that the current implementation reflects what is
tested on each e2e test directory of every package.

You can find a `E2E_TESTS.md` file on all packages that contain an e2e
suite that you have to maintain. This file describes the e2e tests
that must be maintained for that specific feature.

## Tests execution

Tests should be executed by running `pnpm e2e-test` on the root of
this project.

### Test filtering

E2E tests are organized into two categories:

1. **Mock tests**: Tests that work with mocked agents and Docker.
   These run by default and don't require real AI agent setup.

2. **Real agent tests**: Tests that require actual AI agent execution
   in real Docker containers. These are conditionally skipped unless
   explicitly enabled.

#### Running mock-only tests (default)

```bash
# From workspace root
pnpm e2e-test

# Or explicitly
pnpm e2e-test:mock

# From CLI package
cd packages/cli
pnpm e2e-test:mock
```

#### Running real agent tests

Real agent tests require:

- Docker running and able to pull the rover agent image
- A valid AI agent (Claude CLI, Gemini CLI, etc.) installed and authenticated

```bash
# From CLI package
cd packages/cli
pnpm e2e-test:real

# Or manually set the environment variable
ROVER_E2E_REAL_AGENT=true pnpm e2e-test
```

#### Running a specific test

Use the `--grep` flag to filter by test name:

```bash
# Run only mock tests matching a pattern
pnpm e2e-test --grep "alias support"

# Run only real agent tests matching a pattern
ROVER_E2E_REAL_AGENT=true pnpm e2e-test --grep "task restart"
```

### Skip documentation requirements

All skipped tests must have a comment block explaining:

- **Why** the test is skipped (e.g., requires real agent execution)
- **TODO** with actionable instructions on how to unskip the test

**IMPORTANT**: Tests **MUST** use `describe.skipIf(SKIP_REAL_AGENT_TESTS)` or
`it.skipIf(SKIP_REAL_AGENT_TESTS)` from the `e2e-utils.ts` module to conditionally
skip tests. **NEVER** comment out `describe` or `it` blocks. Commented-out tests
will not run even when `ROVER_E2E_REAL_AGENT=true` is set, defeating the purpose
of conditional test execution. Always use the `skipIf` helper to ensure tests can
be enabled via environment variable.

If you are focusing on a specific package, you can run `pnpm e2e-test`
on that package if that script is present in the `package.json` file,
but only for making quicker checks. You **MUST** check that the
overall suite that includes all tests passes before calling a testing
session done.
