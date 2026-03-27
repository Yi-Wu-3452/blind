import fs from 'fs';
import path from 'path';

const baseDir = '/Users/ywu47/Documents/blind/data';
const oldCentralDir = path.join(baseDir, 'comany_posts');
const newCentralDir = path.join(baseDir, 'company_posts');
const companyUrlsDir = path.join(baseDir, 'company_post_urls');

if (!fs.existsSync(newCentralDir)) {
    console.log(`Creating ${newCentralDir}...`);
    fs.mkdirSync(newCentralDir, { recursive: true });
}

// 1. Move from comany_posts to company_posts and rename
if (fs.existsSync(oldCentralDir)) {
    const folders = fs.readdirSync(oldCentralDir);
    for (const folder of folders) {
        const oldPath = path.join(oldCentralDir, folder);
        if (fs.lstatSync(oldPath).isDirectory()) {
            // Rename booking_posts -> booking
            const newName = folder.endsWith('_posts') ? folder.slice(0, -6) : folder;
            const newPath = path.join(newCentralDir, newName);

            console.log(`Moving ${oldPath} to ${newPath}...`);
            if (fs.existsSync(newPath)) {
                // Merge if target exists (unlikely but safe)
                const files = fs.readdirSync(oldPath);
                for (const file of files) {
                    fs.renameSync(path.join(oldPath, file), path.join(newPath, file));
                }
                fs.rmdirSync(oldPath);
            } else {
                fs.renameSync(oldPath, newPath);
            }
        }
    }
    // Try to remove oldCentralDir if empty
    try {
        fs.rmdirSync(oldCentralDir);
        console.log(`Removed empty directory: ${oldCentralDir}`);
    } catch (e) {
        console.warn(`Could not remove ${oldCentralDir}: ${e.message}`);
    }
}

// 2. Move from company_post_urls/<company>/posts to company_posts/<company>
if (fs.existsSync(companyUrlsDir)) {
    const companies = fs.readdirSync(companyUrlsDir);
    for (const company of companies) {
        const companyDir = path.join(companyUrlsDir, company);
        if (fs.lstatSync(companyDir).isDirectory()) {
            const postsDir = path.join(companyDir, 'posts');
            if (fs.existsSync(postsDir) && fs.lstatSync(postsDir).isDirectory()) {
                const targetDir = path.join(newCentralDir, company);
                console.log(`Moving ${postsDir} to ${targetDir}...`);

                if (fs.existsSync(targetDir)) {
                    // Merge
                    const files = fs.readdirSync(postsDir);
                    for (const file of files) {
                        const src = path.join(postsDir, file);
                        const dest = path.join(targetDir, file);
                        if (fs.existsSync(dest) && fs.lstatSync(dest).isDirectory()) {
                            // If it's the images folder, merge it
                            const imgFiles = fs.readdirSync(src);
                            for (const img of imgFiles) {
                                if (!fs.existsSync(path.join(dest, img))) {
                                    fs.renameSync(path.join(src, img), path.join(dest, img));
                                }
                            }
                            fs.rmdirSync(src, { recursive: true });
                        } else {
                            fs.renameSync(src, dest);
                        }
                    }
                    fs.rmdirSync(postsDir);
                } else {
                    fs.renameSync(postsDir, targetDir);
                }
            }
        }
    }
}

console.log('Relocation complete!');
