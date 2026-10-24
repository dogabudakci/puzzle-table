Photo library
=============

Drop photos into this folder (JPG, PNG, WebP or iPhone HEIC) and they appear in the
app's photo library. Delete one here and it disappears from the library.

- The name in the app comes from the file name: "Lake pier.jpg" shows as "Lake pier".
- To choose the order, start file names with numbers: "01 Lake pier.jpg", "02 Oia.jpg" ...
  The numbers are not shown in the app.
- The same photo twice is only added once.

While "Start Puzzle Table.command" is running, just reload the page after adding photos.
Otherwise, run this once in Terminal from the app folder:

    python3 tools/build_library.py
