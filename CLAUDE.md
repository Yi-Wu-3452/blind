# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **TeamBlind scraper and data aggregation system** that collects employee discussion posts, comments, and metadata from company communities on teamblind.com. Companies are organized into size tiers based on post count.

## Common Commands

### URL Collection (Phase 1)
```bash
# Single company
node scripts/core/collect_company_urls_robust.mjs --company="Nvidia" --sort=recent --login

# Batch across a company list
node scripts/core/batch_collect_company_urls.mjs --company-list=company_list_under_100.json --limit=1000

# Mega companies via tags (10k+ posts)
node scripts/core/batch_collect_mega_company_tags.mjs --company=Broadcom
```

### Post Extraction (Phase 2)
```bash
node scripts/core/extract_post_details.mjs --company-list=company_list.json --auto-login
```

### Aggregation & Packaging (Phases 3–4)
```bash
node scripts/core/aggregate_company_posts.mjs --company-list=company_list_under_100.json
node scripts/core/zip_company_data.mjs --master --output=posts_all.zip
```

### Progress Tracking
```bash
node check_1k_10k_progress.mjs          # Companies with 1k–10k posts
node scripts/check_100_1000_progress.mjs # Companies with 100–1k posts
node scripts/find_missing_urls.mjs       # Companies without collected URLs
```

### Options common to most scripts
- `--proxy socks5://127.0.0.1:18080` — route through proxy
- `--use-stealth` — enable puppeteer-extra stealth plugin
- `--account 2` — select credential account (1–3)
- `--manual-login` — pause for manual login instead of auto
- `--user=email --pass=password` — override credentials.json

## Architecture & Pipeline

```
URL Collection → Post Extraction → Aggregation → ZIP Packaging
```

**Data locations:**
- `data/company_post_urls/[company]/` — collected post URLs (recent/top JSON + tag subdirs)
- `data/company_posts/[company]/` — individual post JSONs, images/, logs/, aggregated_posts.json
- `data/posts_company_**/[company]/` — final ZIP archives

**Company list files** segment companies into tiers:
- `company_list_top_6.json` — mega companies (6k–8k+ posts, use tag-based collection)
- `company_list_over_10k.json` / `_with_tags.json`
- `company_list_1000_to_10K.json`
- `company_list_100_to_1000.json`
- `company_list_under_100.json`

## Key Scripts

| Script | Role |
|--------|------|
| `scripts/core/collect_company_urls_robust.mjs` | Single-company URL collection with scroll detection and retry |
| `scripts/core/batch_collect_company_urls.mjs` | Batch URL collection with account rotation |
| `scripts/core/extract_post_details.mjs` | Primary post+comment extractor (~82KB); handles polls, offers, images, nested replies |
| `scripts/core/aggregate_company_posts.mjs` | Merges per-post JSONs into one `aggregated_posts.json` |
| `scripts/core/zip_company_data.mjs` | Packages company data into ZIP archives |
| `scripts/core/logger.mjs` | Timestamped console+file logger, imported by all scripts |
| `scripts/utils/intercept.mjs` | Route interception to block unnecessary resources during scraping |

## Credentials & Authentication

Credentials are loaded from `credentials.json` (3 accounts, not committed per `.gitignore`). Scripts auto-rotate accounts and support proxy + stealth mode for rate-limit avoidance.

Browser sessions are persisted in `browser_profile/` and `browser_profile_3/` directories.

## Dependencies

- **playwright** — primary browser automation
- **playwright-extra** + **puppeteer-extra-plugin-stealth** — anti-bot detection
- **archiver** — ZIP creation for packaging phase

Install: `npm install`

## Performance Notes

The extractor uses DOM stability detection (waits for comment count to stabilize over 300ms) rather than fixed delays — this is ~40–60% faster. See `OPTIMIZATION_NOTES.md` for details.
