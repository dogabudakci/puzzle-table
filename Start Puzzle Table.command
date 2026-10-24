#!/bin/zsh
# Double-click to run Puzzle Table on this Mac. Photos dropped into the "library" folder
# appear in the app's photo library after a page reload. Close this window to stop.
cd "$(dirname "$0")"
(sleep 1 && open "http://localhost:8765") &
python3 tools/serve.py
