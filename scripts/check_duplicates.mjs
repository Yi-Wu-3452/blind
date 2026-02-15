const providedGroups = [
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

const counts = {};
const duplicates = [];

providedGroups.forEach(id => {
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] === 2) {
        duplicates.push(id);
    }
});

if (duplicates.length > 0) {
    console.log("❌ Duplicates found:");
    duplicates.forEach(id => console.log(`- ${id} (Appears ${counts[id]} times)`));
} else {
    console.log("✅ No duplicates found.");
}
console.log(`Summary: Total entries: ${providedGroups.length}, Unique entries: ${Object.keys(counts).length}`);
