# GitHub Copilot Agent Guide

This file provides specific guidance for using the GitHub Copilot agent in the Rover workspace.

## Overview

The GitHub Copilot agent uses the standalone GitHub Copilot CLI (`@github/copilot`) to provide AI-powered code assistance and suggestions.

## Prerequisites

### Installation

```bash
# Install GitHub Copilot CLI
npm install -g @github/copilot
```

### Authentication

The Copilot agent requires GitHub authentication. You can authenticate using:

1. **GitHub CLI (recommended)**:
   ```bash
   gh auth login
   ```

2. **Personal Access Token**:
   ```bash
   export GITHUB_TOKEN=your_token_here
   # or
   export GH_TOKEN=your_token_here
   ```

3. **GitHub Copilot subscription**: Ensure you have an active GitHub Copilot subscription.

## Environment Variables

The Copilot agent supports the following environment variables:

### GitHub Authentication
- `GITHUB_TOKEN` - GitHub personal access token
- `GH_TOKEN` - Alternative token variable

### Copilot Configuration
- `COPILOT_ALLOW_ALL` - Allow all Copilot features
- `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` - Custom instruction directories
- `COPILOT_MODEL` - Specify Copilot model to use

### General Configuration
- `XDG_CONFIG_HOME` - Configuration directory
- `XDG_STATE_HOME` - State directory
- `NO_COLOR` - Disable colored output
- `CLICOLOR` - Control colored output
- `CLICOLOR_FORCE` - Force colored output
- `HTTP_PROXY` - HTTP proxy configuration
- `HTTPS_PROXY` - HTTPS proxy configuration
- `DEBUG` - Enable debug mode

## Usage in Rover

### Basic Usage

```bash
# Use Copilot agent for a task
rover task "explain this code" --agent copilot

# Use Copilot with specific model
COPILOT_MODEL=claude-3-5-sonnet-20241022 rover task "refactor this function" --agent copilot
```

### JSON Output

The Copilot agent supports structured JSON output:

```bash
rover task "analyze this code and return structured data" --agent copilot --json
```

## Best Practices

### 1. Authentication Setup
- Always authenticate with GitHub before using Copilot
- Use `gh auth status` to verify authentication
- Ensure your GitHub account has Copilot access

### 2. Model Selection
- Use `COPILOT_MODEL` to specify the model if needed
- Default model is usually sufficient for most tasks
- Check available models with `copilot help`

### 3. Custom Instructions
- Use `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` for project-specific instructions
- Create custom instruction files for consistent behavior

### 4. Debugging
- Enable `DEBUG=1` for verbose output
- Check `copilot help environment` for all available environment variables

## Troubleshooting

### Common Issues

1. **Authentication Errors**:
   ```bash
   # Check authentication status
   gh auth status
   
   # Re-authenticate if needed
   gh auth login
   ```

2. **Copilot CLI Not Found**:
   ```bash
   # Install Copilot CLI
   npm install -g @github/copilot
   
   # Verify installation
   copilot --version
   ```

3. **Permission Denied**:
   - Ensure your GitHub account has Copilot access
   - Check if your organization allows Copilot usage
   - Verify token permissions

4. **Rate Limiting**:
   - GitHub Copilot has usage limits
   - Wait before retrying if rate limited
   - Check your Copilot subscription status

### Debug Mode

Enable debug mode to troubleshoot issues:

```bash
DEBUG=1 rover task "your prompt" --agent copilot
```

## Integration with Rover Workflows

The Copilot agent integrates seamlessly with Rover's workflow system:

```yaml
# Example workflow using Copilot
version: '1.0'
name: 'copilot-analysis'
description: 'Analyze code using GitHub Copilot'

defaults:
  tool: copilot
  model: default

steps:
  - id: analyze_code
    type: agent
    name: 'Analyze Code'
    prompt: |
      Analyze the following code and provide suggestions for improvement:
      {{code}}
```

## Security Considerations

- **Token Security**: Never commit GitHub tokens to version control
- **Environment Variables**: Use secure methods to set environment variables
- **Code Privacy**: Be aware that code sent to Copilot may be processed by GitHub
- **Organization Policies**: Check your organization's Copilot usage policies

## Performance Tips

1. **Batch Requests**: Group related questions together
2. **Clear Prompts**: Be specific in your prompts for better results
3. **Context Management**: Provide sufficient context for complex tasks
4. **Model Selection**: Choose appropriate models for your use case

## Support

- **GitHub Copilot Documentation**: https://docs.github.com/en/copilot
- **Copilot CLI Help**: `copilot help`
- **Environment Variables**: `copilot help environment`
- **Rover Issues**: Report agent-specific issues in the Rover repository
