const { app, BrowserWindow, globalShortcut, screen, clipboard, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

app.name = 'NeetTracker';

// 1. Single Instance Lock - Prevent multiple Electron instances fighting for CPU/RAM
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// 2. Hardware & Power optimization flags to guarantee minimal idle CPU consumption
app.commandLine.appendSwitch('disable-background-timer-throttling', 'false');
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'false');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');

let mainWindow = null;
let focusLossCount = 0;
let processScannerInterval = null;
let multiMonitorCheckInterval = null;
let isExamActive = false;
let isScanningProcesses = false;
let currentMultiDisplayState = null;
const lastAlertTimes = {};

// Prohibited processes known for screen recording, capturing, or remote access (Pearson VUE / SEB standard)
const BLACKLISTED_PROCESSES = [
    'obs64.exe', 'obs32.exe', 'obs.exe',
    'lightshot.exe',
    'sharex.exe',
    'snippingtool.exe',
    'screenclippinghost.exe',
    'snagit32.exe', 'snagit64.exe',
    'bandicam.exe',
    'camtasia.exe',
    'fraps.exe',
    'anydesk.exe',
    'teamviewer.exe',
    'ultraviewer.exe',
    'rustdesk.exe',
    'vncserver.exe',
    'discord.exe'
];

function triggerSecurityAlert(type, message, details = {}) {
    // Debounce to prevent hammering IPC, clipboard, or audio beeps
    const now = Date.now();
    if (lastAlertTimes[type] && (now - lastAlertTimes[type]) < 2500) {
        return;
    }
    lastAlertTimes[type] = now;

    console.warn(`[NeetTracker Security Alert] ${type}: ${message}`, details);
    
    // Clear clipboard immediately to sanitize any captured data buffer
    try {
        clipboard.clear();
    } catch (err) {
        // Safe ignore
    }

    // Audible alert beep
    try {
        shell.beep();
    } catch (err) {
        // Safe ignore
    }

    // Transmit telemetry to the NeetTracker web application context
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        const payload = JSON.stringify({
            type,
            message,
            details,
            timestamp: now
        });

        mainWindow.webContents.executeJavaScript(`
            (function() {
                try {
                    const eventData = ${payload};
                    window.dispatchEvent(new CustomEvent('neettracker-security-violation', { detail: eventData }));
                    
                    // Display prominent floating security toast inside renderer if not already present
                    let alertBanner = document.getElementById('neettracker-os-security-banner');
                    if (!alertBanner) {
                        alertBanner = document.createElement('div');
                        alertBanner.id = 'neettracker-os-security-banner';
                        alertBanner.style.position = 'fixed';
                        alertBanner.style.top = '16px';
                        alertBanner.style.left = '50%';
                        alertBanner.style.transform = 'translateX(-50%)';
                        alertBanner.style.backgroundColor = '#DC2626';
                        alertBanner.style.color = '#FFFFFF';
                        alertBanner.style.padding = '12px 24px';
                        alertBanner.style.borderRadius = '8px';
                        alertBanner.style.fontSize = '14px';
                        alertBanner.style.fontWeight = 'bold';
                        alertBanner.style.zIndex = '999999';
                        alertBanner.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.4)';
                        alertBanner.style.display = 'flex';
                        alertBanner.style.alignItems = 'center';
                        alertBanner.style.gap = '10px';
                        alertBanner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                        document.body.appendChild(alertBanner);
                    }
                    alertBanner.innerHTML = '<span style="display:inline-block;padding:2px 8px;background:rgba(255,255,255,0.2);border-radius:4px;font-size:11px;font-weight:700;margin-right:8px;text-transform:uppercase;letter-spacing:0.5px;">Security Notice</span><span>' + eventData.message + '</span>';
                    alertBanner.style.display = 'flex';
                    
                    if (window._ntAlertTimeout) clearTimeout(window._ntAlertTimeout);
                    window._ntAlertTimeout = setTimeout(() => {
                        if (alertBanner) alertBanner.style.display = 'none';
                    }, 5000);
                } catch (e) {
                    console.error('Failed to render NeetTracker security banner:', e);
                }
            })();
        `).catch(() => {});
    }
}

// Multi-Monitor / Secondary Display Enforcement
// Optimized: Checks in-memory display count first and skips IPC/DOM execution unless state changed
function checkDisplays(force = false) {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;

    try {
        const displays = screen.getAllDisplays();
        const hasMultipleDisplays = displays.length > 1;

        if (!force && hasMultipleDisplays === currentMultiDisplayState) {
            // Zero CPU & Zero IPC: display layout unchanged
            return;
        }
        currentMultiDisplayState = hasMultipleDisplays;

        mainWindow.webContents.executeJavaScript(`
            (function() {
                try {
                    let overlay = document.getElementById('neettracker-multi-monitor-overlay');
                    if (${hasMultipleDisplays}) {
                        if (!overlay) {
                            overlay = document.createElement('div');
                            overlay.id = 'neettracker-multi-monitor-overlay';
                            overlay.style.position = 'fixed';
                            overlay.style.top = '0';
                            overlay.style.left = '0';
                            overlay.style.width = '100vw';
                            overlay.style.height = '100vh';
                            overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.98)';
                            overlay.style.color = '#ffffff';
                            overlay.style.display = 'flex';
                            overlay.style.flexDirection = 'column';
                            overlay.style.alignItems = 'center';
                            overlay.style.justifyContent = 'center';
                            overlay.style.zIndex = '9999999';
                            overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                            overlay.style.textAlign = 'center';
                            overlay.style.padding = '40px';
                            overlay.innerHTML = \`
                                <div style="max-width: 540px; background: #1E293B; border: 2px solid #EF4444; border-radius: 16px; padding: 36px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                                    <div style="margin-bottom: 20px; display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3);">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                            <line x1="8" y1="21" x2="16" y2="21"></line>
                                            <line x1="12" y1="17" x2="12" y2="21"></line>
                                            <line x1="2" y1="2" x2="22" y2="22" stroke="#EF4444" stroke-width="2.5"></line>
                                        </svg>
                                    </div>
                                    <h2 style="font-size: 22px; font-weight: 800; color: #F87171; margin-bottom: 12px; letter-spacing: -0.5px;">Multiple Displays Detected</h2>
                                    <p style="font-size: 14px; color: #CBD5E1; line-height: 1.6; margin-bottom: 20px;">
                                        To maintain exam security standards (Pearson VUE / Safe Exam Browser compliance), <strong>NeetTracker</strong> strictly restricts testing to a single primary display.
                                    </p>
                                    <div style="background: #0F172A; border-radius: 8px; padding: 14px; font-size: 13px; color: #94A3B8; text-align: left;">
                                        <p style="margin: 0 0 6px 0;"><strong>Action Required:</strong></p>
                                        <ul style="margin: 0; padding-left: 20px;">
                                            <li>Disconnect external monitors, HDMI/DP cables, or projectors.</li>
                                            <li>Disable virtual displays or screen mirroring (Sidecar, Miracast).</li>
                                        </ul>
                                    </div>
                                    <p style="font-size: 12px; color: #64748B; margin-top: 18px; margin-bottom: 0;">
                                        This screen will automatically unlock once secondary displays are disconnected.
                                    </p>
                                </div>
                            \`;
                            document.body.appendChild(overlay);
                        } else {
                            overlay.style.display = 'flex';
                        }
                    } else if (overlay) {
                        overlay.style.display = 'none';
                    }
                } catch(e) {}
            })();
        `).catch(() => {});
    } catch (err) {
        // Safe ignore
    }
}

// Background Process Watchdog Scanner (Periodic check for prohibited tools)
// Optimized: Runs ONLY during active exams, throttled to 25s, with concurrency guard and hidden console
function scanRunningProcesses() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.platform !== 'win32') return;
    if (!isExamActive) return; // Zero CPU outside active exams
    if (isScanningProcesses) return; // Prevent concurrent sub-processes

    isScanningProcesses = true;
    exec('tasklist /FO CSV /NH', { windowsHide: true }, (error, stdout) => {
        isScanningProcesses = false;
        if (error || !stdout) return;
        const lowerOut = stdout.toLowerCase();
        for (const proc of BLACKLISTED_PROCESSES) {
            if (lowerOut.includes(proc.toLowerCase())) {
                triggerSecurityAlert(
                    'PROHIBITED_PROCESS_DETECTED',
                    `Prohibited application detected: ${proc}. Please close it to continue.`,
                    { processName: proc }
                );
                break;
            }
        }
    });
}

// Dynamically track exam vs navigation states
function updateExamState() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
        isExamActive = false;
        return;
    }
    try {
        const currentUrl = (mainWindow.webContents.getURL() || '').toLowerCase();
        const wasExam = isExamActive;
        
        isExamActive = currentUrl.includes('/take') ||
                       currentUrl.includes('/cbt') ||
                       (currentUrl.includes('/exam') && 
                        !currentUrl.includes('/exams/create') && 
                        !currentUrl.includes('/student/exams') && 
                        !currentUrl.includes('/exams/list'));

        if (isExamActive && !wasExam) {
            console.log('[NeetTracker] Live exam environment entered. Activating security kiosk & watchdog.');
            mainWindow.setKiosk(true);
            checkDisplays(true);
            scanRunningProcesses();
        } else if (!isExamActive && wasExam) {
            console.log('[NeetTracker] Live exam session ended. Restoring standard window mode.');
            if (mainWindow.isKiosk()) {
                mainWindow.setKiosk(false);
            }
        }
    } catch (e) {
        // Safe ignore
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "NeetTracker",
        icon: path.join(__dirname, 'icon.png'),
        show: false,
        backgroundColor: '#0F172A',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: false,
            spellcheck: false,              // Disables background spellcheck service running constantly in renderer
            backgroundThrottling: true,     // Throttles animations and timers when window is minimized or blurred
            autoplayPolicy: 'user-gesture-required',
            webgl: true
        }
    });

    mainWindow.maximize();
    mainWindow.show();

    // 1. Hardware/OS Screen Capture & Recording Blackout
    mainWindow.setContentProtection(true);

    // Re-enforce content protection on focus or restore
    mainWindow.on('focus', () => {
        mainWindow.setContentProtection(true);
    });
    mainWindow.on('restore', () => {
        mainWindow.setContentProtection(true);
    });

    // 2. Set official User-Agent
    mainWindow.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 NeetTracker-Desktop/1.0.1');

    // 3. Attach verified app header for NeetTracker backend validation
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['X-App-Client'] = 'NeetTracker-Secure-Wrapper';
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // 4. Low-Level Keyboard Interception (Catch before webview or OS processes keystrokes)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const key = input.key ? input.key.toLowerCase() : '';

        // Block PrintScreen & Alt+PrtScn
        if (key === 'printscreen') {
            event.preventDefault();
            triggerSecurityAlert('PRINTSCREEN_BLOCKED', 'Screenshot attempt intercepted and blocked.');
            return;
        }

        // Block Win + Shift + S (Windows Snipping Tool)
        if (input.meta && input.shift && key === 's') {
            event.preventDefault();
            triggerSecurityAlert('SNIPPING_TOOL_BLOCKED', 'Windows Snipping Tool shortcut intercepted.');
            return;
        }

        // Block Ctrl + Shift + S (Browser Web Capture)
        if (input.control && input.shift && key === 's') {
            event.preventDefault();
            triggerSecurityAlert('WEB_CAPTURE_BLOCKED', 'Capture shortcut intercepted.');
            return;
        }

        // Block Ctrl + P (Print to PDF / Printer)
        if (input.control && key === 'p') {
            event.preventDefault();
            triggerSecurityAlert('PRINT_BLOCKED', 'Printing is disabled during examinations.');
            return;
        }

        // Block Ctrl + S (Save webpage)
        if (input.control && key === 's') {
            event.preventDefault();
            triggerSecurityAlert('SAVE_PAGE_BLOCKED', 'Saving examination pages is prohibited.');
            return;
        }

        // Block DevTools & Page Source (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
        if (key === 'f12' || (input.control && input.shift && (key === 'i' || key === 'j')) || (input.control && key === 'u')) {
            event.preventDefault();
            triggerSecurityAlert('DEVTOOLS_BLOCKED', 'Developer inspection tools are strictly disabled.');
            return;
        }

        // Block Page Reloads (F5, Ctrl+R)
        if (key === 'f5' || (input.control && key === 'r')) {
            event.preventDefault();
            triggerSecurityAlert('RELOAD_BLOCKED', 'Page reloads are disabled inside active test frames.');
            return;
        }
    });

    // 5. Anti-Tamper: Block Right-Click Context Menus
    mainWindow.webContents.on('context-menu', (event) => {
        event.preventDefault();
    });

    // 6. Anti-Tamper: Close any DevTools immediately if forced
    mainWindow.webContents.on('devtools-opened', () => {
        mainWindow.webContents.closeDevTools();
    });

    // 7. Focus Loss Watchdog (Window Blur Tracking - Active only during exams)
    mainWindow.on('blur', () => {
        if (!isExamActive) return;

        focusLossCount++;
        triggerSecurityAlert(
            'FOCUS_LOST',
            `Focus lost from exam environment. Incident #${focusLossCount} logged.`,
            { focusLossCount }
        );
    });

    // 8. Exam Mode Auto-Detection & Kiosk Enforcement on Page Navigations
    mainWindow.webContents.on('did-finish-load', () => {
        updateExamState();
        checkDisplays(true);
    });
    mainWindow.webContents.on('did-navigate', updateExamState);
    mainWindow.webContents.on('did-navigate-in-page', updateExamState);

    // 9. Load hosted NeetTracker URL
    mainWindow.loadURL('https://app.neettracker.com/app-welcome');

    // Hide standard menu bar
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);

    mainWindow.on('closed', () => {
        mainWindow = null;
        isExamActive = false;
        currentMultiDisplayState = null;
    });
}

app.on('ready', () => {
    createWindow();

    // Register OS Global Shortcuts to intercept screenshot shortcuts at system focus level
    globalShortcut.register('PrintScreen', () => {
        triggerSecurityAlert('PRINTSCREEN_BLOCKED', 'Screenshot shortcut intercepted.');
    });
    globalShortcut.register('CommandOrControl+Shift+3', () => {
        triggerSecurityAlert('SCREENSHOT_BLOCKED', 'Screenshot shortcut intercepted.');
    });
    globalShortcut.register('CommandOrControl+Shift+4', () => {
        triggerSecurityAlert('SCREENSHOT_BLOCKED', 'Area screenshot shortcut intercepted.');
    });
    globalShortcut.register('CommandOrControl+R', () => {
        // Prevent accidental reloads
    });
    globalShortcut.register('F5', () => {
        // Prevent accidental reloads
    });

    // Monitor display configuration changes dynamically via native OS events
    screen.on('display-added', () => checkDisplays(true));
    screen.on('display-removed', () => checkDisplays(true));
    screen.on('display-metrics-changed', () => checkDisplays(true));

    // Initial check
    checkDisplays(true);

    // Background process scanner (throttled to 25s, active ONLY during live exams)
    processScannerInterval = setInterval(scanRunningProcesses, 25000);

    // Secondary display check safety fallback (throttled to 15s; 0 IPC when display layout is stable)
    multiMonitorCheckInterval = setInterval(checkDisplays, 15000);
});

app.on('will-quit', () => {
    // Clear monitoring intervals
    if (processScannerInterval) clearInterval(processScannerInterval);
    if (multiMonitorCheckInterval) clearInterval(multiMonitorCheckInterval);

    // Cleanly unregister all hotkeys so user's operating system keyboard is unaffected
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
