# Rover Demos

This directory contains VHS demos for showcasing Rover's capabilities. These demos create animated terminal recordings that demonstrate various Rover features.

## Prerequisites

Before running the demos, ensure you have the following installed:

### Required Software

1. **VHS** - Terminal recording tool (already available in the Nix development shell)
2. **FiraCode Nerd Font** - Required font for proper rendering
3. **Docker** - Required for Rover to run tasks
4. **Rover CLI** - Must be installed and accessible in PATH

## Running Demos

Use the provided `run.sh` script to execute any tape file. The script handles cleanup of temporary directories and Docker containers automatically.

```bash
# Run a specific demo
./run.sh task.tape

# Example: Run the full Rover demo
./run.sh rover.tape
```

### What the Script Does

1. **Pre-run Cleanup**
   - Removes `/tmp/rover-demo` directory if it exists (requires sudo)
   - Checks for running `rover-task-*` containers and prompts to stop them

2. **Executes VHS**
   - Runs the specified tape file to generate the recording

3. **Post-run Cleanup**
   - Cleans up temporary directories and containers again

## Contributing New Demos

When adding new demos:

1. Follow the naming convention: `feature-name.tape`
2. Include clear comments explaining the demo's purpose
3. Test the demo with the `run.sh` script
4. Update this README with the new demo details
5. Commit both the tape file and generated outputs

## Best Practices for Creating Demos

Based on the existing demos, here are recommended practices for creating effective VHS recordings:

### Timing and Pacing

- **Sleep before actions**: Add 250-500ms delays before typing for natural pacing

  ```vhs
  Sleep 250ms
  Type "rover init ."
  ```

- **Pause after Enter**: Wait 500ms after pressing Enter for better readability

  ```vhs
  Type "rover task"
  Sleep 500ms Enter
  ```

- **Show results**: Add 3-5 second pauses to let viewers read important output
  ```vhs
  Sleep 5s  # Let user see the task list
  ```

### Visual Styling

- **Consistent window styling**: Use colorful window bars with rounded corners
- **Appropriate font size**: 22-32px depending on content complexity
- **Letter spacing**: 0.8 for better readability
- **Margins and padding**: 20px margin, 30px padding for clean appearance

### Setup and Cleanup

- **Hide setup commands**: Use `Hide/Show` to skip boring setup

  ```vhs
  Hide
  Type "cd /tmp/rover-demo" Enter
  Type "clear" Enter
  Show
  ```

- **Clear screen strategically**: Clear before showing new sections
  ```vhs
  Type "clear"
  Sleep 500ms Enter
  ```

### Content Organization

- **Add section headers**: Use comments to explain what's happening

  ```vhs
  Type "# Initialize rover in a new repository"
  Sleep 500ms Enter
  ```

- **Wait for specific content**: Use `Wait+Screen` for dynamic content

  ```vhs
  Wait+Screen@30s /Task Details/
  ```

- **Simulate realistic typing**: Set TypingSpeed to 0.1 for natural speed

### Output Formats

- **Multiple formats**: Generate both GIF and WebM for flexibility
  ```vhs
  Output demo.gif
  Output demo.webm
  ```

## Demo Template

Here's a template for creating new Rover demos:

```vhs
# Demo: [Your Demo Title]
# Description: [What this demo showcases]

# Output configuration
Output demo.gif
Output demo.webm

# Requirements
Require rover

# Visual styling
Set WindowBar Colorful
Set Margin 20
Set MarginFill "#107e7a"
Set BorderRadius 10
Set Padding 30

# Terminal configuration
Set Shell "bash"
Set FontSize 28
Set FontFamily "FiraCode Nerd Font Mono"
Set LetterSpacing 0.8
Set Width 1600
Set Height 900
Set TypingSpeed 0.1
Set Framerate 24

Hide
# Setup (hidden from recording)
Show

# The demo!
```

## Troubleshooting

### Common Issues

1. **Font not rendering correctly**
   - Ensure FiraCode Nerd Font is installed system-wide
   - Restart your terminal after font installation

2. **VHS command not found**
   - Verify VHS is installed: `which vhs`
   - Add VHS to your PATH if needed

3. **Docker containers still running**
   - The script will prompt to stop them
   - Manual cleanup: `docker stop $(docker ps -q --filter "name=rover-task")`

4. **Permission denied for /tmp/rover-demo**
   - The script uses sudo for cleanup
   - Ensure you have sudo access
