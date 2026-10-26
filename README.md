# NeetTracker Standalone Desktop Application Wrapper

This repository holds the standalone, native desktop wrapper for the **NeetTracker** exam platform. It wraps the hosted web application securely inside an **Electron** wrapper.

## Project Structure & Location
* **Location on your machine**: `/Users/apple/Movies/Electronlab/Neettracker-App`
* This project is completely isolated from the website repository, keeping the website source code clean.

## Security & Privacy Configurations
* **OS-Level Screen Capture Blackout**: `SetWindowDisplayAffinity` (`setContentProtection(true)`) ensures screen recording tools (OBS, Zoom, Discord, Snipping Tool) only capture an opaque black window.
* **Hardware Key Interception**: Low-level interception for `PrintScreen`, `Win+Shift+S`, `Alt+PrtScn`, `F12`, and reload shortcuts.
* **Instant Clipboard Auto-Wipe**: Instantly neutralizes OS clipboard buffer upon screenshot key presses or window focus changes.
* **Multi-Monitor Blocker**: Detects secondary displays and requires single-screen mode for exam integrity.
* **Background Process Watchdog**: Monitors for prohibited screen recording and remote desktop tools.
* **DevTools Disabled**: Standard chrome developer tools are completely deactivated to prevent tampering.
* **Navigation Hiding**: Standard browser window control menus, back/forward buttons, and address inputs are hidden.

## Compiled Executables
The build outputs are saved under the `dist/` directory:
1. **Windows Installer**: `dist/NeetTracker Setup 1.0.1.exe`
2. **Windows Unpacked**: `dist/win-unpacked/`

## Brand Logo & Icons
* The application uses the brand's official icon scaled for high-resolution display on Windows and macOS.

---

## Build & Dev Commands

To package or develop the desktop application:

### 1. Run in Development Mode
```bash
npm start
```

### 2. Package for Windows (NSIS Installer)
```bash
npm run build:win
```

### 3. Package for Microsoft Store (AppX/MSIX)
```bash
npm run build:store
```
