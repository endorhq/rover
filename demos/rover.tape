# A full demo of rover initializing in a project and running two tasks in parallel
# Target size: 805x520 (x2 = 1610x1040)

# Output rover.gif
Output rover.webm

Require rover

# Styling
Set WindowBar Colorful
Set Margin 20
Set MarginFill "#107e7a"
Set BorderRadius 10
Set Padding 30

Set Shell "bash"
Set FontSize 22
Set FontFamily "FiraCode Nerd Font Mono"
Set LetterSpacing 0.8
Set Width 1610
Set Height 1040
Set TypingSpeed 0.1
Set Framerate 24

# Place into the right location. It expects a "../demo"
Hide
Type@0ms "mkdir /tmp/rover-demo" Enter
Type@0ms "cd /tmp/rover-demo" Enter
Type@0ms "git init" Enter
Type@0ms "touch README.md" Enter
Type@0ms "git add . && git commit --no-gpg-sign -m 'feat: initial commit'" Enter
Type@0ms "clear" Enter
Show

Sleep 250ms
Type "# Initialize rover in a new repository"
Sleep 500ms Enter
Sleep 250ms Type "rover init ." 
Sleep 500ms Enter
Wait+Screen@20s /AI Agents/
Sleep 5s
Down
Sleep 1s
Up
Sleep 500ms Enter
Sleep 5s
Type "y"

Sleep 5s

Type "clear" 
Sleep 500ms Enter

Hide
Type@0ms "git add . && git commit --no-gpg-sign -m 'feat: add rover'" Enter
Type@0ms "clear" Enter
Show

Sleep 1s
Type "# Create your first task"
Sleep 500ms Enter
Sleep 250ms Type "rover task"
Sleep 500ms Enter
Sleep 4s
Type "Create a minimal SvelteKit website using Svelte 5 syntax. Just create the homepage with a stylish hello world message"
Sleep 1s
Enter

# Wait for expanding the task
Wait+Screen@30s /Task Details/
Sleep 5s
Enter 

# Wait for the container to start
Wait+Screen@30s /Starting Docker container/
Sleep 6s

Type "clear" 
Sleep 500ms Enter

Sleep 1s Type "# Create a new task and run it in parallel using Gemini!" 
Sleep 500ms Enter
Sleep 250ms Type "rover task --agent gemini" 
Sleep 500ms Enter
Sleep 4s
Type "Add a GitHub action to build a SvelteKit project. For now, assume the project is on the root and it uses npm to run scripts"
Sleep 1s
Enter

# Wait for expanding the task
Wait+Screen@30s /Task Details/
Sleep 5s
Enter

# Wait for the container to start
Wait+Screen@30s /Starting Docker container/
Sleep 6s

Type "clear" 
Sleep 500ms Enter

Sleep 1s Type "# You can check the status of the tasks" 
Sleep 500ms Enter
Sleep 250ms Type "rover ls" 
Sleep 500ms Enter

Sleep 5s Type "# Now, you can continue working. Rover will take care of those tasks."
Sleep 5s
