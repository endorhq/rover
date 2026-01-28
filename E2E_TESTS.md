# End to end testing (e2e testing)

Maintain a set of End-To-End (e2e) tests for this project.

These tests must ensure that the funcional requirements are met. Tests
are organized in test suites. A Test suite is responsible for testing
a specific Rover feature. Within a test suite, multiple tests might be
run to ensure that a certain feature is working as expected.

Tests **MUST NOT** relay on order of execution. They can be shuffled
at all times and are expected to behave in the same way. Every test
suite starts from a clean slate, it cannot share any persistent state
with other test suites. Unless stated otherwise, tests within a test
suite are also order independent and they **MUST NOT** require a
certain state of the system set by other tests.

## Test location

Every package conforming Rover **MIGHT** have its own e2e tests. You
should make sure that the current implementation reflects what is
tested on each e2e test directory of every package.

You can find a `E2E_TESTS.md` file on all packages that contain an e2e
suite that you have to maintain. This file describes the e2e tests
that must be maintained for that specific feature.

## Test execution

Tests should be executed by running `pnpm e2e-test` on the root of
this project.

If you are focusing on a specific package, you can run `pnpm e2e-test`
on that package if that script is present in the `package.json` file,
but only for making quicker checks. You **MUST** check that the
overall suite that includes all tests passes before calling a testing
session done.
