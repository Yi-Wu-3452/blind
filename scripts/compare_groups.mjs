import fs from 'fs';
import path from 'path';

const providedGroups = [
    "comment-group-48424761",
    "comment-group-48425223",
    "comment-group-48426745",
    "comment-group-48439034",
    "comment-group-48427053",
    "comment-group-48427085",
    "comment-group-48427764",
    "comment-group-48429558",
    "comment-group-48426117",
    "comment-group-48426494",
    "comment-group-48426494",
    "comment-group-48430834",
    "comment-group-48426010",
    "comment-group-48430132",
    "comment-group-48425921",
    "comment-group-48429704",
    "comment-group-48428017",
    "comment-group-48428945",
    "comment-group-48436395",
    "comment-group-48429524",
    "comment-group-48431630",
    "comment-group-48429427",
    "comment-group-48425597",
    "comment-group-48430526",
    "comment-group-48432536",
    "comment-group-48431929",
    "comment-group-48428509",
    "comment-group-48426670",
    "comment-group-48426158",
    "comment-group-48430362",
    "comment-group-48431561",
    "comment-group-48437777",
    "comment-group-48426348",
    "comment-group-48429340",
    "comment-group-48433926",
    "comment-group-48430401",
    "comment-group-48428518",
    "comment-group-48427919",
    "comment-group-48437089",
    "comment-group-48430780",
    "comment-group-48429369",
    "comment-group-48445180",
    "comment-group-48435252",
    "comment-group-48434803",
    "comment-group-48432433",
    "comment-group-48428598",
    "comment-group-48433398",
    "comment-group-48427336",
    "comment-group-48433194",
    "comment-group-48428541",
    "comment-group-48425082",
    "comment-group-48475827",
    "comment-group-48444738",
    "comment-group-48437718",
    "comment-group-48436997",
    "comment-group-48436900",
    "comment-group-48434881",
    "comment-group-48434726",
    "comment-group-48433368",
    "comment-group-48433062",
    "comment-group-48430744",
    "comment-group-48430066",
    "comment-group-48427924",
    "comment-group-48427509",
    "comment-group-48426636",
    "comment-group-48426294"
];

const filePath = process.argv[2];
const jsonData = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));

const scrapedGroups = new Set();
if (jsonData.debug && jsonData.debug.all_comment_ids) {
    jsonData.debug.all_comment_ids.forEach(item => {
        if (item.commentGroupId) scrapedGroups.add(item.commentGroupId);
    });
} else {
    const collectGroups = (items) => {
        if (!items || !Array.isArray(items)) return;
        items.forEach(item => {
            if (item.commentGroupId) scrapedGroups.add(item.commentGroupId);
            if (item.nested) collectGroups(item.nested);
        });
    };
    collectGroups(jsonData.replies);
}

console.log(`\n🔍 Group Comparison Results`);
console.log(`--------------------------------------------------`);
console.log(`Provided list unique groups: ${new Set(providedGroups).size}`);
console.log(`Unique scraped groups:       ${scrapedGroups.size}`);

const notInScraped = [...new Set(providedGroups)].filter(id => !scrapedGroups.has(id));

if (notInScraped.length === 0) {
    console.log(`✅ All groups in your list are present in the JSON.`);
} else {
    console.log(`❌ Found ${notInScraped.length} group(s) from your list NOT in the JSON:`);
    notInScraped.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
}

const missingFromUserList = [...scrapedGroups].filter(id => !providedGroups.includes(id));
if (missingFromUserList.length > 0) {
    console.log(`\n💡 Also found ${missingFromUserList.length} group(s) in JSON NOT in your provided list:`);
    missingFromUserList.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
}
console.log(`--------------------------------------------------\n`);
