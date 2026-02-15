import fs from 'fs';
import path from 'path';

const latestList = [
    "comment-group-48424761",
    "comment-group-48425223",
    "comment-group-48426745",
    "comment-group-48439034",
    "comment-group-48427053",
    "comment-group-48427085",
    "comment-group-48427764",
    "comment-group-48433511",
    "comment-group-48429558",
    "comment-group-48426117",
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

const filePath = "data/rerun_nvidia_investigation/nvidia-is-now-worth-5-trillion-dollars-uqp7xzjt.json";
const jsonData = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));

const scrapedGroups = new Set();
jsonData.debug.all_comment_ids.forEach(item => {
    if (item.commentGroupId) scrapedGroups.add(item.commentGroupId);
});

const latestSet = new Set(latestList);

console.log(`\n🔍 Final Comparison`);
console.log(`--------------------------------------------------`);
console.log(`Scraped from JSON:    ${scrapedGroups.size}`);
console.log(`Provided in list:      ${latestSet.size}`);

const notInScraped = [...latestSet].filter(id => !scrapedGroups.has(id));
const missingFromJson = [...scrapedGroups].filter(id => !latestSet.has(id));

if (notInScraped.length > 0) {
    console.log(`\n❌ Groups in your list NOT in the JSON (Extra):`);
    notInScraped.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
}

if (missingFromJson.length > 0) {
    console.log(`\n⚠️ Groups in JSON NOT in your list (Missing from your list):`);
    missingFromJson.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
}

if (notInScraped.length === 0 && missingFromJson.length === 0) {
    console.log(`✅ Perfect Match!`);
}
console.log(`--------------------------------------------------\n`);
