const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
    console.log('[afterPack] Pruning non-Microsoft driver files and elevation helpers for Microsoft Store compliance...');
    const appOutDir = context.appOutDir;

    // Files that trigger Microsoft Store policy 10.2.4.2 (Security - Software Dependencies / Non-Microsoft drivers)
    const filesToRemove = [
        'vk_swiftshader_icd.json',
        'vk_swiftshader.dll',
        'vulkan-1.dll',
        path.join('resources', 'elevate.exe')
    ];

    for (const file of filesToRemove) {
        const fullPath = path.join(appOutDir, file);
        if (fs.existsSync(fullPath)) {
            try {
                fs.unlinkSync(fullPath);
                console.log(`[afterPack] Removed non-compliant driver/helper: ${file}`);
            } catch (err) {
                console.warn(`[afterPack] Could not remove ${file}:`, err.message);
            }
        }
    }
};
