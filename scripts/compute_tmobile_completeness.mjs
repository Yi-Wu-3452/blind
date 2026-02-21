import fs from 'fs';
import path from 'path';

/**
 * Recursively counts replies and their nested replies.
 */
function countReplies(replies) {
    if (!replies || !Array.isArray(replies)) return 0;
    let count = 0;
    for (const reply of replies) {
        count += 1;
        if (reply.nested) {
            count += countReplies(reply.nested);
        }
    }
    return count;
}

function main() {
    const targetDir = process.argv[2] || 'data/tmobile_posts';
    const absTargetDir = path.resolve(targetDir);

    if (!fs.existsSync(absTargetDir)) {
        console.error(`Error: Directory not found at ${absTargetDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(absTargetDir).filter(f => f.endsWith('.json'));

    let totalExpectedTotal = 0;
    let totalActualTotal = 0;
    const postResults = [];

    // console.log(`\nAnalyzing ${files.length} posts in ${targetDir}...\n`);

    for (const file of files) {
        const filePath = path.join(absTargetDir, file);
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            const expected = parseInt(data.commentsCount, 10) || 0;
            const totalScraped = data.scrapedCommentsCount !== undefined
                ? data.scrapedCommentsCount
                : countReplies(data.replies);
            const deleted = parseInt(data.deletedCommentsCount, 10) || 0;
            const actual = totalScraped - deleted;

            const diff = actual - expected;
            const completeness = expected === 0 ? 100 : (actual / expected) * 100;

            postResults.push({
                file: file,
                url: data.url || 'N/A',
                expected: expected,
                actual: actual,
                diff: diff,
                completeness: completeness.toFixed(2)
            });

            totalExpectedTotal += expected;
            totalActualTotal += actual;

        } catch (error) {
            console.error(`Error processing ${file}: ${error.message}`);
        }
    }

    // Sort: incomplete first, then by filename
    postResults.sort((a, b) => {
        const compA = parseFloat(a.completeness);
        const compB = parseFloat(b.completeness);
        if (compA !== compB) {
            return compA - compB;
        }
        return a.file.localeCompare(b.file);
    });

    // Print Markdown Report
    process.stdout.write(`# Comment Scraping Completeness Report\n\n`);
    process.stdout.write(`Generated on: ${new Date().toISOString().split('T')[0]}\n\n`);

    const overallCompleteness = totalExpectedTotal === 0 ? 100 : (totalActualTotal / totalExpectedTotal) * 100;
    const averageCompleteness = postResults.length === 0 ? 0 : postResults.reduce((acc, res) => acc + parseFloat(res.completeness), 0) / postResults.length;

    process.stdout.write(`## Overall Summary\n\n`);
    process.stdout.write(`| Metric | Value |\n`);
    process.stdout.write(`| :--- | :--- |\n`);
    process.stdout.write(`| Total Posts | ${files.length} |\n`);
    process.stdout.write(`| Total Expected Comments | ${totalExpectedTotal} |\n`);
    process.stdout.write(`| Total Actual Scraped | ${totalActualTotal} |\n`);
    process.stdout.write(`| Total Missing | ${totalExpectedTotal - totalActualTotal} |\n`);
    process.stdout.write(`| Overall Completeness | **${overallCompleteness.toFixed(2)}%** |\n`);
    process.stdout.write(`| Average Per-Post Completeness | **${averageCompleteness.toFixed(2)}%** |\n\n`);

    process.stdout.write(`## Per-Post Details\n\n`);
    process.stdout.write(`| Filename | Expected | Actual | Diff | Comp % | Status | URL |\n`);
    process.stdout.write(`| :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`);

    postResults.forEach(res => {
        const statusIcon = parseFloat(res.completeness) >= 100 ? '✅' : '❌';
        process.stdout.write(`| ${res.file} | ${res.expected} | ${res.actual} | ${res.diff} | ${res.completeness}% | ${statusIcon} | [Link](${res.url}) |\n`);
    });
}

main();
