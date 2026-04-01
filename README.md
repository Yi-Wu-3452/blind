# TeamBlind Scraper

Collects posts, comments, and metadata from company communities on [teamblind.com](https://www.teamblind.com). Covers S&P 500 companies organized into size tiers.

---

## Prerequisites

- **Node.js v18+** — [Download here](https://nodejs.org)
- **TeamBlind account(s)** — needed to access post data
- *(Optional)* A SOCKS5 proxy for rate-limit avoidance

---

## Setup

```bash
git clone <repo-url>
cd blind
bash setup.sh
```

`setup.sh` will:
1. Check your Node.js version
2. Install npm dependencies
3. Install Playwright's Chromium browser

Then **edit `credentials.json`** with your TeamBlind account credentials:

```json
{
  "1": { "email": "you@example.com", "password": "yourpassword" },
  "2": { "email": "account2@example.com", "password": "password2" }
}
```

> **What is an "account"?**
> Each entry is a TeamBlind login. The scraper uses these to authenticate and fetch post data.
> The keys (`"1"`, `"2"`, ...) are account numbers you reference via `--account 1` or `--account 2` when running commands.
> You only need one account to get started. Having multiple lets different collaborators scrape in parallel using different logins to avoid rate limits.

---

## Pipeline

The scraper runs in two phases per company tier:

```
Phase 1: Collect post URLs  →  Phase 2: Scrape post details
```

### Mega companies (10k+ posts)

```bash
# Phase 1 — collect URLs by tag
npm run pick:10k:collect

# Phase 2 — scrape post details
npm run pick:10k -- --account 1
```

### Regular companies (1k–10k posts)

```bash
# Phase 1 is already done for most companies.
# Jump straight to scraping:
npm run pick:1k -- --account 1
```

### Check progress

```bash
npm run progress:1k    # 1k–10k tier
npm run progress:100   # 100–1k tier
```

### Package results

```bash
npm run aggregate -- --company-list=company_list_1000_to_10K.json
npm run zip
```

---

## Common Options

| Option | Description |
|--------|-------------|
| `--account 1` | Use account #1 from `credentials.json` |
| `--proxy socks5://127.0.0.1:18080` | Route through a SOCKS5 proxy |
| `--login` | Manually log in via browser |
| `--use-stealth` | Enable stealth plugin (anti-bot) |
| `--dry-run` | Preview picker selection without running |
| `--reverse` | Process URLs in reverse order |
| `--delay 5000` | Delay between posts in ms (default: 8000) |

---

## Data Layout

```
data/
  company_post_urls/
    <company>/
      <company>_recent.json     # collected post URLs (regular)
      <company>_top.json
      tags/                     # tag-based URLs (mega companies)
        <tag>_recent.json
        <tag>_top.json
  company_posts/
    <company>/
      <post-id>.json            # scraped post + comments
      images/
      logs/
      aggregated_posts.json
```

---

## Splitting Work Across Collaborators

Each person picks different companies via the interactive picker:

```bash
npm run pick:1k -- --account <your-account-number>
```

The picker shows remaining companies with progress bars — just pick numbers that haven't been claimed by others.

If using a shared proxy tunnel:
```bash
npm run pick:1k -- --account 1 --proxy socks5://127.0.0.1:18080
```
