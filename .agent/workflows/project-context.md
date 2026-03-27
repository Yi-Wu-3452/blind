---
description: High-level context and technical patterns for the Team Blind scraper project.
---

# Team Blind Scraper: Project Context

This document provides critical context for any agent working on the Team Blind scraper project.

## Project Objectives
- Scrape post details and full comment trees from Team Blind for S&P 500 companies.
- Maintain organic navigation patterns to avoid bot detection / rate limits.
- Standardize all extracted data (dates, usernames, company, replies, polls).

---

## Active Scripts

### Post Extraction
| Script | Purpose |
|---|---|
| [`extract_post_details_v2.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/extract_post_details_v2.mjs) | **Current production scraper.** Batch company mode, `buildUniversalTree`, `--prev-retry`, proxy support, auto-login. |
| [`extract_post_details_optimized.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/extract_post_details_optimized.mjs) | Older single-company baseline. Use as reference only. |
| [`extract_post_details_greedy.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/extract_post_details_greedy.mjs) | Legacy greedy scraper. Deprecated. |

### URL Collection
| Script | Purpose |
|---|---|
| [`collect_company_urls_robust.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/collect_company_urls_robust.mjs) | Robust collector; writes per-company `<safeName>_recent.json` under `data/company_post_urls/<safeName>/`. |
| [`batch_collect_company_urls.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/batch_collect_company_urls.mjs) | Batch wrapper around the robust collector for entire company lists. |
| [`collect_company_urls.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/collect_company_urls.mjs) | Older single-company collector. |

### Utilities
| Script | Purpose |
|---|---|
| [`aggregate_company_posts.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/aggregate_company_posts.mjs) | Merges scraped per-post JSONs into a single master file. |
| [`zip_company_data.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/zip_company_data.mjs) | Zips company output directories for archiving. |
| [`manual_login_launcher.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/manual_login_launcher.mjs) | Launches a persistent browser for manual login session setup. |
| [`logger.mjs`](file:///Users/ywu47/Documents/blind/scripts/core/logger.mjs) | Shared logger utility (file + stdout). |

---

## Company Lists (root level)
| File | Description |
|---|---|
| `company_list.json` | Full S&P 500 Blind-filtered master list |
| `company_list_1000_to_10K.json` | Companies with 1K–10K posts |
| `company_list_100_to_1000.json` | Companies with 100–1K posts |
| `company_list_under_100.json` | Companies with <100 posts |

---

## Data Directory Layout
```
data/
  company_post_urls/
    <safe_company_name>/
      <safe_company_name>_recent.json   ← URL list (output of URL collector)
      posts/                            ← Per-post JSON files (output of v2 scraper)
        logs/                           ← Per-post scrape logs
        failed_post_urls.txt            ← Permanent failures
        missing_posts.txt               ← Posts that redirected to home (deleted)
  posts_optimized/                      ← Legacy single-batch output dir
  nvidia_post_urls.txt                  ← Legacy NVIDIA URL list
  images/                               ← Downloaded post images (legacy path)
```

---

## Technical Stack
- **Runtime**: Node.js (ESM, `.mjs`)
- **Browser Automation**: Playwright + `playwright-extra`
- **Stealth**: `puppeteer-extra-plugin-stealth` (disabled when login flags are active)
- **Credentials**: `credentials.json` at root, keyed by account name (`--account <key>`)

---

## Key CLI Flags for `extract_post_details_v2.mjs`

| Flag | Effect |
|---|---|
| `--company-list=<file>` | Batch mode: iterate over a company list JSON |
| `--no-capture-toplevel` | Disable incremental top-level comment snapshotting (on by default) |
| `--auto-login` | Human-like automated login (types with delays, checks Stay signed in) |
| `--login-wait` | Opens browser and waits for manual login |
| `--manual-login` | Pre-fills credentials, waits for user to submit |
| `--persistent` | Use a persistent browser profile (per `--account` suffix) |
| `--new-browser` | Launch a fresh browser instance per URL |
| `--proxy <url>` | Route traffic through HTTP or SOCKS5 proxy |
| `--reverse` | Process URL list from tail to head |
| `--prev-retry` | Lighter retry mode: 3 retries instead of 9 |
| `--delay <ms>` | Base cooldown between posts (default: 8000ms) |
| `--jitter <multiplier>` | Random jitter fraction added to delay (default: 0.75) |
| `--verbose` | Enable debug logging and verbose DOM inspection |
| `--account <key>` | Select credentials and browser profile by key name |

---

## Core Patterns & Strategies

### 1. Comment Tree: `buildUniversalTree` (v2)
- Collects **all** comment groups across the entire page into a single flat stream.
- Sorts by **absolute visual position** (`getBoundingClientRect().top + scrollY`) — more reliable than `offsetTop`.
- Infers depth from Tailwind `pl-[Npx]` classes, falling back to visual left offset.
- Uses a **scan-back strategy** to find the logical "head" of a thread when the root comment is deleted.
- Strips duplicate anchor comments when injecting external thread-page results.
- Merges a `capturedTopLevelResults` rescue dict for comments virtualized out of the DOM.

### 2. Incremental Capture (`doCapture`)
- Called after every "View more comments" click and at the end of Phase 1.
- Snapshots all current `div[id^="comment-group-"]` elements into `topLevelResults`.
- Enabled **by default** in v2; disable with `--no-capture-toplevel`.
- Prevents data loss when the browser virtualizes old comments out of the DOM.

### 3. Rate Limit Handling
- Detection: "Oops! Something went wrong" page with `blindapp@teamblind.com`.
- Recovery: 30s deep-breath cooldown + navigate to home to reset session.
- Total retry budget: **9 retries** (flat 10s intervals) or **3** with `--prev-retry`.
- Permanent failures written to `failed_post_urls.txt`; deleted posts to `missing_posts.txt`.

### 4. Stealth / Anti-Detection
- Stealth plugin is only applied when **not** using any login flag (login mode needs real CAPTCHA rendering).
- Analytics, Google Tag Manager, and font resources are blocked via `ctx.route()`.
- `--auto-login` uses randomized typing delays to simulate a human.

### 5. UI Interaction
- All button clicks use `element.evaluate(b => b.click())` (JS click) — bypasses sticky overlays.
- Sticky headers, overlays, and cookie banners are hidden via `element.style.display = 'none'` before scraping.
- `waitForDOMStability()` polls `div[id^="comment-"]` count until stable for ≥300ms (max 3s).

### 6. DOM Identification
- Comment groups: `div[id^="comment-group-"]`
- Individual comments: `div[id^="comment-"]:not([id^="comment-group-"])`
- Flagged/deleted: leaf `div` with text "Flagged by the community" (no children)

---

## Output Data Schema (per post JSON)

```jsonc
{
  "url": "https://www.teamblind.com/post/...",
  "scrapeTime": "2025-02-24 10:30",
  "post_type": "regular_post" | "poll_post",
  "title": "...",
  "content": "...",
  "userName": "...",
  "userCompany": "...",
  "date": "YYYY-MM-DD",
  "channel": "...",
  "likes": "...",
  "views": "...",
  "commentsCount": "...",    // as reported by Blind UI
  "scrapedCommentsCount": 0, // actual count in replies tree
  "deletedCommentsCount": 0, // isFlagged count
  "images": [],
  "poll": { ... } | null,
  "relatedCompanies": [],
  "relatedTopics": [],
  "replies": [
    {
      "userName": "...", "company": "...", "date": "YYYY-MM-DD",
      "content": "...", "likes": "...", "images": [],
      "commentId": "comment-XXXXXXXX",
      "commentGroupId": "comment-group-XXXXXXXX",
      "nestedCount": 0,
      "nested": [ /* recursive same shape */ ],
      "isFlagged": false  // true for deleted/flagged comments
    }
  ],
  "time_elapsed": "12.3"
}
```