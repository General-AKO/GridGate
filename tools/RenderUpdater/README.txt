GridGate Render Update Manager
==============================

Files:
- GridGate_Render_Updater_GUI.ps1 : the GUI application
- START_RENDER_UPDATER.bat        : double-click this to open the GUI

How to use:
1. Double-click START_RENDER_UPDATER.bat.
2. In "New GridGate version folder", choose the newly downloaded version (for example GridGate_DualHost_v0.8).
3. In "Permanent Git repository folder", choose the OLD/PERMANENT folder that contains the hidden .git directory and is already linked to GitHub/Render.
4. Enter a commit message, or leave the default.
5. Click "Validate Paths".
6. Click "Update Render".

The tool:
- preserves .git
- preserves node_modules, .wrangler and .dev.vars
- copies/synchronizes the new version
- runs npm install
- runs npm test
- runs git status
- runs git add -A
- creates the commit
- runs git push
- shows every step in the LOG area
- stays open if an error occurs

Render:
If Auto-Deploy is enabled in Render, the git push triggers the deployment automatically.
