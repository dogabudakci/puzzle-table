#!/bin/zsh
# Double-click to run Puzzle Table on this Mac. Photos dropped into the "library" folder
# appear in the app's photo library after a page reload. Close this window to stop.
#
# The first time (and whenever requirements.txt changes) it sets up the server's packages in
# ~/.puzzle-table-env, outside iCloud, so iCloud doesn't have to sync thousands of small files.
cd "$(dirname "$0")"
ENV="$HOME/.puzzle-table-env"
STAMP="$ENV/.requirements"
if [[ ! -x "$ENV/bin/python" ]] || ! cmp -s requirements.txt "$STAMP"; then
  echo "Setting up Puzzle Table (only needed once)…"
  python3 -m venv "$ENV" && "$ENV/bin/pip" install --quiet --upgrade pip \
    && "$ENV/bin/pip" install --quiet -r requirements.txt pillow && cp requirements.txt "$STAMP" \
    || { echo "Setup failed: check the internet connection and try again."; read; exit 1; }
fi
(sleep 2 && open "http://localhost:8765") &
"$ENV/bin/python" tools/serve.py
