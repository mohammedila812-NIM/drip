# Drip

Drip is a transparent, dynamic-island-style desktop companion for Windows, built with Tauri 2, React, and TypeScript.

## Plugins

At runtime, Drip loads plugin folders from `%APPDATA%\dev.drip.app\plugins\<id>`. Each folder contains a `plugin.json` manifest and one of these formats:

```json
{ "name": "Plugin name", "main": "index.js", "permissions": [] }
```

This starts `index.js` as a sandboxed Web Worker. Or use an executable plugin:

```json
{ "name": "Plugin name", "exec": ["powershell", "-File", "script.ps1"], "permissions": [] }
```

Executable plugins exchange one JSON object per line over standard input and output. Both formats may request `fg` to receive foreground-window data and `peek` to open the island programmatically.

Example plugins are included in [`plugins`](plugins).

Download the installer from **Actions > Artifacts** or **Releases**.
