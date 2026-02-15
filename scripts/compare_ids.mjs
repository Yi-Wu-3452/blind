import fs from 'fs';
import path from 'path';

const providedList = [
    "comment-48424761",
    "comment-48424830",
    "comment-48425084",
    "comment-48425831",
    "comment-48425223",
    "comment-48425876",
    "comment-48427272",
    "comment-48426745",
    "comment-48427535",
    "comment-48428812",
    "comment-48429300",
    "comment-48439034",
    "comment-48439182",
    "comment-48448041",
    "comment-48463272",
    "comment-48427053",
    "comment-48427085",
    "comment-48427386",
    "comment-48427547",
    "comment-48427690",
    "comment-48427764",
    "comment-48428504",
    "comment-48432577",
    "comment-48433017",
    "comment-48429558",
    "comment-48430028",
    "comment-48426117",
    "comment-48426494",
    "comment-48427062",
    "comment-48433366",
    "comment-48434301",
    "comment-48426494",
    "comment-48427062",
    "comment-48433366",
    "comment-48434301",
    "comment-48430834",
    "comment-48430954",
    "comment-48431618",
    "comment-48432866",
    "comment-48426010",
    "comment-48426300",
    "comment-48427123",
    "comment-48430132",
    "comment-48436879",
    "comment-48425921",
    "comment-48431872",
    "comment-48432399",
    "comment-48433035",
    "comment-48429704",
    "comment-48432962",
    "comment-48428017",
    "comment-48428043",
    "comment-48428945",
    "comment-48429085",
    "comment-48429225",
    "comment-48433401",
    "comment-48436395",
    "comment-48429524",
    "comment-48431630",
    "comment-48429427",
    "comment-48429468",
    "comment-48430106",
    "comment-48433030",
    "comment-48425597",
    "comment-48429142",
    "comment-48429614",
    "comment-48430526",
    "comment-48432004",
    "comment-48434224",
    "comment-48432536",
    "comment-48434235",
    "comment-48431929",
    "comment-48428509",
    "comment-48426670",
    "comment-48426158",
    "comment-48430362",
    "comment-48433893",
    "comment-48431561",
    "comment-48431575",
    "comment-48432980",
    "comment-48437777",
    "comment-48460516",
    "comment-48426348",
    "comment-48427379",
    "comment-48430177",
    "comment-48433427",
    "comment-48429340",
    "comment-48430073",
    "comment-48433926",
    "comment-48430401",
    "comment-48428518",
    "comment-48427919",
    "comment-48437089",
    "comment-48430780",
    "comment-48429369",
    "comment-48429839",
    "comment-48445180",
    "comment-48435252",
    "comment-48434803",
    "comment-48432433",
    "comment-48428598",
    "comment-48433398",
    "comment-48433487",
    "comment-48427336",
    "comment-48431025",
    "comment-48433194",
    "comment-48428541",
    "comment-48425082",
    "comment-48475827",
    "comment-48444738",
    "comment-48437718",
    "comment-48436997",
    "comment-48436900",
    "comment-48434881",
    "comment-48434726",
    "comment-48433368",
    "comment-48433062",
    "comment-48430744",
    "comment-48430066",
    "comment-48427924",
    "comment-48427509",
    "comment-48426636",
    "comment-48426294"
];

const filePath = process.argv[2];
const jsonData = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));

const scrapedIds = new Set();
const collectIds = (items) => {
    if (!items || !Array.isArray(items)) return;
    items.forEach(item => {
        if (item.commentId) scrapedIds.add(item.commentId);
        if (item.nested) collectIds(item.nested);
    });
};
collectIds(jsonData.replies);

console.log(`\n🔍 Comparison Results`);
console.log(`--------------------------------------------------`);
console.log(`Provided list entries: ${providedList.length}`);
console.log(`Unique scraped IDs:    ${scrapedIds.size}`);

const notInScraped = providedList.filter(id => !scrapedIds.has(id));

if (notInScraped.length === 0) {
    console.log(`✅ All IDs in your list are present in the JSON.`);
} else {
    console.log(`❌ Found ${notInScraped.length} IDs from your list NOT in the JSON:`);
    notInScraped.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));
}

const missingFromUserList = [...scrapedIds].filter(id => !providedList.includes(id));
console.log(`\n💡 Also found ${missingFromUserList.length} IDs in JSON NOT in your provided list.`);
console.log(`--------------------------------------------------\n`);
