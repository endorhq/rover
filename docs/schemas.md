# Project File Schemas

Rover maintains the state using local JSON and YAML files. It constantly creates, parse, and update these files. We need a maintainable way to properly create, manage, and use them across all the different tools in the project (CLIs and extension).

## Architecture

All schema definitions, types, and tooling, are defined in the `packages/schema` internal package. Other packages like `cli` and `rover-agent` use them to manage these files consistently.

Each project file, such as `rover.json` or `iteration.json`, have the following associated code:

- `packages/schemas/src/<name>/schema.js: file schema definition using Zod v4 library
- `packages/schemas/src/<name>/types.js: TypeScript types inferred from the Zod definition
- `packages/schemas/src/<name>/errors.js: Custom error types
- `packages/schemas/src/<name>.js: a wrapper class to load and manage a file
- `packages/schemas/src/<name>-store.js: (optional) a class to load and manage related files. It understands the locations and folder structure to look for them.

## Common properties

All the different project files includes a `version` property. This `string` simplifies detecting and managing different versions. The format is `Major.Minor`.

## Naming conventions

We use `workflow` as an example in the following list:

- Filenames:
  - `packages/schemas/src/workflow/schema.js`
  - `packages/schemas/src/workflow/types.js`
  - `packages/schemas/src/workflow/errors.js`
  - `packages/schemas/src/workflow.js`
  - `packages/schemas/src/workflow-store.js`
- Constant, types, and class names:
  - Zod schema definition: `<Type>Schema`. For example, `WorkflowSchema` and `WorkflowInputTypeSchema`
  - TypeScript types: `<Type>`. For example, `Workflow` and `WorkflowInputType`
  - Custom errors: `<Type><Reason>Error`. For example, `WorkflowLoadError` or `WorkflowValidationError`
  - Wrapper class: `<Type>Manager`. For example, `WorkflowManager`
  - Store class: `<Type>Store`. For example, `WorkflowStore`

## Working with multiple versions

We use the `version` property to identify and update project files. By default, we migrate the files to newer versions automatically, so we ensure users always have the latest compatible version. For that, we update the version value based on the schema changes:

- `Major`: bump when there's a major refactor or incompatibilities with previous versions
- `Minor`: add new elements or remove optional / non-used values. We can easily migrate from previous versions to the new one

### Incompatibilities

For incompatibilities, we should always increase the major version and create a separate `schema` and `types`. We should try to keep a single wrapper class and type, so we avoid branching code based on the version in the rest of the clients.
