
const fs = require('fs');
const path = require('path');

const logDir = 'data/tmobile_posts/logs';
if (!fs.existsSync(logDir)) {
    console.error(`Log directory ${logDir} not found.`);
    process.exit(1);
}

const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));

let totalBlocked = 0;
let successAt1 = 0;
let successAt2 = 0;
let successAt3 = 0;
let permanentFailure = 0;

files.forEach(file => {
    const logPath = path.join(logDir, file);
    const content = fs.readFileSync(logPath, 'utf-8');
    const jsonPath = path.join('data/tmobile_posts', file.replace('.log', '.json'));
    const isSaved = fs.existsSync(jsonPath);

    // Count occurrences of "Detected Blind Error Page"
    const blockMatches = content.match(/Detected Blind Error Page/g);
    const blockCount = blockMatches ? blockMatches.length : 0;

    if (blockCount > 0) {
        totalBlocked++;
        if (isSaved) {
            if (blockCount === 1) successAt1++;
            else if (blockCount === 2) successAt2++;
            else if (blockCount === 3) successAt3++;
            else permanentFailure++;
        } else {
            permanentFailure++;
        }
    }
});

console.log(`Total Posts Encountering Blocks: ${totalBlocked}`);
console.log(`----------------------------------------`);
console.log(`Resumed successfully at Retry 1: ${successAt1} (${((successAt1 / totalBlocked) * 100).toFixed(1)}%)`);
console.log(`Resumed successfully at Retry 2: ${successAt2} (${((successAt2 / totalBlocked) * 100).toFixed(1)}%)`);
console.log(`Resumed successfully at Retry 3: ${successAt3} (${((successAt3 / totalBlocked) * 100).toFixed(1)}%)`);
console.log(`Failed after all retries:        ${permanentFailure} (${((permanentFailure / totalBlocked) * 100).toFixed(1)}%)`);
