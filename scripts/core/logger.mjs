import fs from 'fs';
import util from 'util';

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

let activeLogFile = null;

export function setActiveLogFile(logFile) {
    activeLogFile = logFile;
}

function writeToLogFile(level, ...args) {
    if (!activeLogFile) return;

    try {
        const timestamp = new Date().toISOString();
        const message = util.format(...args);
        const logLine = `[${timestamp}] [${level}] ${message}\n`;
        fs.appendFileSync(activeLogFile, logLine, 'utf-8');
    } catch (e) {
        // Fallback to original console error if file write fails to prevent crash loop
        originalConsoleError("[Logger Error] Failed to write to log file:", e.message);
    }
}

// Override global console methods
console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    writeToLogFile('INFO', ...args);
};

console.error = function (...args) {
    originalConsoleError.apply(console, args);
    writeToLogFile('ERROR', ...args);
};

console.warn = function (...args) {
    originalConsoleWarn.apply(console, args);
    writeToLogFile('WARN', ...args);
};
