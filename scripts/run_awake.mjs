#!/usr/bin/env node
/**
 * run_awake.mjs
 * Runs a command while preventing the system from sleeping.
 * - macOS: uses caffeinate
 * - Windows: uses powercfg to temporarily disable sleep
 * - Linux: uses systemd-inhibit if available, otherwise runs directly
 *
 * Usage: node scripts/run_awake.mjs <command> [args...]
 */

import { spawn, execSync } from 'child_process';
import os from 'os';

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node scripts/run_awake.mjs <command> [args...]');
    process.exit(1);
}

const platform = os.platform();
let child;

if (platform === 'darwin') {
    child = spawn('caffeinate', ['-d', ...args], { stdio: 'inherit' });
} else if (platform === 'win32') {
    // On Windows, use a PowerShell keep-awake loop in the background
    const psScript = `
$job = Start-Job {
    while ($true) {
        $wsh = New-Object -ComObject WScript.Shell
        $wsh.SendKeys('+{F15}')
        Start-Sleep -Seconds 60
    }
}
try {
    & ${args.map(a => `"${a}"`).join(' ')}
} finally {
    Stop-Job $job
    Remove-Job $job
}
`.trim();
    child = spawn('powershell', ['-Command', psScript], { stdio: 'inherit', shell: true });
} else {
    // Linux: use systemd-inhibit if available
    try {
        execSync('which systemd-inhibit', { stdio: 'ignore' });
        child = spawn('systemd-inhibit', ['--what=sleep:idle', '--who=blind-scraper', '--why=Scraping in progress', ...args], { stdio: 'inherit' });
    } catch {
        // Fall back to running directly
        console.warn('⚠️  systemd-inhibit not found, running without sleep prevention.');
        child = spawn(args[0], args.slice(1), { stdio: 'inherit' });
    }
}

child.on('exit', (code) => process.exit(code ?? 0));
