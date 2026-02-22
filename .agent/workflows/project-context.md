---
description: High-level context and technical patterns for the Team Blind scraper project.
---

# Team Blind Scraper: Project Context

This document provides critical context for any agent working on the Team Blind scraper project. Follow these patterns and rules to ensure robustness and stealth.

## Project Objectives
- Robustly scrape post details and comments from Team Blind.
- Maintain a strictly organic navigation pattern to avoid bot detection.
- Standardize all extracted data (dates, user info, poll/offer details).

## Main Scraper Scripts
- **Post Details**: [extract_post_details_v2.mjs](file:///Users/ywu47/Documents/blind/scripts/core/extract_post_details_v2.mjs)
- **Company URLs**: [collect_company_urls_robust.mjs](file:///Users/ywu47/Documents/blind/scripts/core/collect_company_urls_robust.mjs)


## Technical Stack
- **Runtime**: Node.js
- **Browser Automation**: Playwright
- **Stealth**: `playwright-extra` with stealth plugin.

## Core Patterns & Strategies

### 1. Organic Navigation
- **Crucial**: Do not navigate directly to post URLs for large-scale scrapes.
- **Workflow**: Navigate to the company "Posts" list -> Open each post in a **New Tab** (`context.newPage()`) with the list URL as `Referer`.
- This mimics human behavior and signficantly reduces 403/block errors.

### 2. Stability vs. Timers
- **Rule**: Avoid `page.waitForTimeout()` with fixed values.
- **Pattern**: Use `waitForDOMStability()`. This polls the DOM (e.g., comment count) and proceeds only after the content has stopped changing for a set duration (usually 300ms).

### 3. Rate Limit Handling
- **Threshold**: Blocks often occur after ~25-30% of a large batch or very quickly if navigation is too aggressive.
- **Sweet Spot**: A **40-second delay** (Exponential Backoff) is the most effective recovery point for Blind's rate limits.
- **Mechanism**: Detect the "Oops! Something went wrong" page and trigger a cooldown.

### 4. UI Interaction Hacks
- **Expanding Threads**: Use `element.evaluate(b => b.click())` instead of `element.click()`. This ensures the click event is triggered via JavaScript even if sticky headers or modals are visually overlapping the button.
- **Blocking Modals**: Aggressively dismiss "Get Full Access" or "Sign in" modals that block the underlying content.

### 5. DOM Identification
- **Comments**: Target `div[id^="comment-"]` but exclude `[id^="comment-group-"]` to avoid overcounting.
- **Post Data**: Record `yyyy-mm-dd hh:mm` scrape time and normalize all comment dates to `YYYY-MM-DD`.

## Data Schema
- Data is stored in `data/` directory, often categorized by company name.
- Images are downloaded locally to `data/images/[post-slug]/`.