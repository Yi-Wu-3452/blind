import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GREEDY_DIR = path.resolve(__dirname, "../data/posts_greedy");
const OPTIMIZED_DIR = path.resolve(__dirname, "../data/posts_optimized");

function countRepliesRecursive(replies) {
    let total = replies.length;
    for (const r of replies) {
        if (r.nested) {
            total += countRepliesRecursive(r.nested);
        }
    }
    return total;
}

function getStats(dir) {
    const stats = {};
    if (!fs.existsSync(dir)) return stats;

    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        stats[file] = {
            totalComments: countRepliesRecursive(data.replies || []),
            metadataCount: parseInt(data.commentsCount) || 0
        };
    }
    return stats;
}

async function verify() {
    const greedyStats = getStats(GREEDY_DIR);
    const optimizedStats = getStats(OPTIMIZED_DIR);

    console.log("----------------------------------------------------------------------------------");
    console.log("| Post File                          | Greedy Count | Optimized Count | Status |");
    console.log("----------------------------------------------------------------------------------");

    let totalGreedy = 0;
    let totalOptimized = 0;
    let matched = 0;
    let totalFiles = 0;

    const allFiles = Array.from(new Set([...Object.keys(greedyStats), ...Object.keys(optimizedStats)]));

    for (const file of allFiles) {
        const g = greedyStats[file] || { totalComments: 0 };
        const o = optimizedStats[file] || { totalComments: 0 };

        const status = o.totalComments >= g.totalComments ? "✅ PASS" : `❌ LOST ${g.totalComments - o.totalComments}`;

        console.log(`| ${file.padEnd(35)} | ${g.totalComments.toString().padEnd(12)} | ${o.totalComments.toString().padEnd(15)} | ${status} |`);

        totalGreedy += g.totalComments;
        totalOptimized += o.totalComments;
        if (o.totalComments >= g.totalComments) matched++;
        totalFiles++;
    }

    console.log("----------------------------------------------------------------------------------");
    console.log(`Summary: ${matched}/${totalFiles} files passed integrity check.`);
    console.log(`Total Comments (Greedy): ${totalGreedy}`);
    console.log(`Total Comments (Optimized): ${totalOptimized}`);
    console.log(`Net Gain/Loss: ${totalOptimized - totalGreedy} comments`);
}

verify();
