# Demo for running a task with Rover
Output task.gif
Output task.webm

Require rover

# Styling
Set WindowBar Colorful
Set Margin 20
Set MarginFill "#107e7a"
Set BorderRadius 10
Set Padding 30

Set Shell "bash"
Set FontSize 32
Set FontFamily "FiraCode Nerd Font Mono"
Set LetterSpacing 0.8
Set Width 1800
Set Height 800
Set TypingSpeed 0.1
Set Framerate 24

Hide
Type "cd ../" Enter 
Type "clear" Enter
Show

Sleep 250ms
Type "# Assign a new task to an agent with Rover" 
Sleep 500ms Enter
Type "rover task -s main"
Sleep 500ms Enter

Sleep 3s
Type "Complete any task you want! :)"
Sleep 3s
