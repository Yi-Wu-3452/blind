import fs from 'fs';

const filePath = '/Users/ywu47/Documents/blind/data/test_batch_login_final/nvidia-ceo-i-would-rather-grow-employees-than-firing-them-258afwdi.json';
const userIds = [
    "comment-48766726",
    "comment-48767396",
    "comment-48767506",
    "comment-48768070",
    "comment-48774887",
    "comment-48774919",
    "comment-48777394",
    "comment-48781846",
    "comment-48786304",
    "comment-48786319",
    "comment-48789126",
    "comment-48813089",
    "comment-48775173",
    "comment-48776792",
    "comment-48780757",
    "comment-48766735",
    "comment-48766946",
    "comment-48768266",
    "comment-48775662",
    "comment-48786231",
    "comment-48786291",
    "comment-48786297",
    "comment-48784500",
    "comment-48784806",
    "comment-48791085",
    "comment-48786977",
    "comment-48787110",
    "comment-48787785",
    "comment-48785246",
    "comment-48786307",
    "comment-48786382",
    "comment-48786405",
    "comment-48767322",
    "comment-48782703",
    "comment-48791024",
    "comment-48786485",
    "comment-48787131",
    "comment-48787159",
    "comment-48787188",
    "comment-48788279",
    "comment-48790880",
    "comment-48792010",
    "comment-48793182",
    "comment-48771464",
    "comment-48797601",
    "comment-48805627",
    "comment-48790722",
    "comment-48805073",
    "comment-48789561",
    "comment-48790246",
    "comment-48790810",
    "comment-48795152",
    "comment-48770345",
    "comment-48787874",
    "comment-48788524",
    "comment-48789474",
    "comment-48789857",
    "comment-48766911",
    "comment-48767295",
    "comment-48774163",
    "comment-48785593",
    "comment-48786298",
    "comment-48786939",
    "comment-48786962",
    "comment-48787126",
    "comment-48787758",
    "comment-48786564",
    "comment-48786947",
    "comment-49036872",
    "comment-48768436",
    "comment-48788234",
    "comment-48787264",
    "comment-48789922",
    "comment-48771804",
    "comment-48785100",
    "comment-48956526",
    "comment-48980500",
    "comment-48773887",
    "comment-48785142",
    "comment-48785861",
    "comment-48787429",
    "comment-48792316",
    "comment-49015136",
    "comment-49164701",
    "comment-48786434",
    "comment-48786384",
    "comment-49343650",
    "comment-48805156",
    "comment-48792248",
    "comment-48788043",
    "comment-49362613",
    "comment-48805822",
    "comment-48769222",
    "comment-48769563",
    "comment-48769702",
    "comment-48770639"
];

const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

function extractAllIds(replies) {
    let ids = [];
    for (const reply of replies) {
        if (reply.commentId) ids.push(reply.commentId);
        if (reply.nested && reply.nested.length > 0) {
            ids = ids.concat(extractAllIds(reply.nested));
        }
    }
    return ids;
}

const extractedIds = extractAllIds(data.replies);
const uniqueExtractedIds = [...new Set(extractedIds)];

const missing = userIds.filter(id => !uniqueExtractedIds.includes(id));
const extra = uniqueExtractedIds.filter(id => !userIds.includes(id));

console.log('--- EXTRACTED IDS (Total: ' + extractedIds.length + ', Unique: ' + uniqueExtractedIds.length + ') ---');
console.log('--- USER IDS (Count: ' + userIds.length + ') ---');

console.log('--- MISSING FROM JSON ---');
console.log(JSON.stringify(missing, null, 2));

if (extra.length > 10) {
    console.log('--- EXTRA IN JSON (Showing first 10 of ' + extra.length + ') ---');
    console.log(JSON.stringify(extra.slice(0, 10), null, 2));
} else {
    console.log('--- EXTRA IN JSON ---');
    console.log(JSON.stringify(extra, null, 2));
}
