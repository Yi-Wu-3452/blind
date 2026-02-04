# Scraper Enhancement Report

This document records the requirements provided by the user and the implementation details for the Teamblind scraper enhancements.

## 1. Requirements Overview

| Feature | Requirement Description | Expected Format |
| :--- | :--- | :--- |
| **Scrape Time** | Record the exact time each post was scraped. | `yyyy-mm-dd hh:mm` |
| **User Info Accuracy** | Correctly separate `userName` and `userCompany` when the company is "New" or "Undisclosed". | Company: "New", Name: [Actual Name] |
| **Date Normalization** | Convert all dates (relative and absolute) into a single standard format. | `YYYY-MM-DD` |

| **Poll/Offer Extraction** | Accurately detect and extract data from Polls and Offers, including participant counts and nested sentiment data. | `post_type`, `pollData`, `optionX_votes`, `optionX_tc` |

## 2. Implementation Details

### A. Post Type Identification
- Implemented a hierarchy of detectors (badges, channel names, and header text).
- `post_type` is now a top-level field: `"poll"`, `"offer"`, or `"regular_post"`.
- Added auto-clicking of "View Result" buttons to reveal hidden poll/offer data.

### B. User Extraction Logic Fix
- **Problem**: The previous logic relied on CSS selectors that failed to distinguish between the company and name when the company was not a clickable link (like "New" or "Undisclosed").
- **Fix**: Targeted the OP header container and extracted info based on DOM `childNodes` order.
- **Verified**: Handled "New", "Undisclosed", and specific company links correctly.

### C. Date Normalization Engine
- **Engine**: Created `normalizeDate()` to handle relative and absolute dates.
- **Recursive Processing**: Ensures all nested comments have standardized `YYYY-MM-DD` dates.
- **Legacy Migration**: Ran a migration script across existing data.

### D. Poll & Offer Extraction Engine
- **Participants**: Extracts total participant counts, handling comma-separated strings (e.g., `6,484`).
- **Polls**: Captures option labels (including emojis like `🍿`), percentages, and vote counts.
- **Offers**: 
    - Extracts structured blocks for each offer.
    - Captures **TC**, **Base**, **Equity**, **Sign-on**, and **Bonus** (e.g., `$550K`, `$300K`, `$250K`).
    - Handles both inline values (`TC: $550K`) and sibling element structures (`<div>$300K</div><div>Base</div>`).
    - Extracts **Role** and **Level** for each option.
    - Calculates percentages and votes for each offer option.
- **Flattened Output**: Injected `option1_votes`, `option1_percent`, `option1_tc`, `option1_base`, `option1_equity` for direct spreadsheet/analysis use.

### E. Image Extraction & Local Storage
- **Main Post Images**: Extracts all images from the post body (`images` array).
- **Comment Images**: Extracts images from all replies and nested replies.
- **Local Download**: Automatically downloads all images to `data/images/[post-slug]/`.
- **Source Mapping**: Prefixes filenames with source ID (e.g., `comment-49153053_image.jpeg`, `post_image.jpeg`).
- **JSON Integration**: Adds `localImages` array to both main post and each reply for easy reference.

## 3. Results
- **URL 1**: [NVIDIA Poll](https://www.teamblind.com/post/is-nvidia-really-fcked-like-everyone-says-uakgdxh7)
    - `post_type`: **"poll"**
    - `participants`: **6484**
- **URL 2**: [NVIDIA/Startup Offer](https://www.teamblind.com/post/nvidia-vs-startup-wh0rtba4)
    - `post_type`: **"offer"**
    - `option1_tc`: **"$550K"**
    - `option1_base`: **"$300K"**
    - `option1_equity`: **"$250K"**
    - `option1_signOn`: **"-"**
    - `option1_bonus`: **"-"**
- **All Data**: Correctly integrated into the greedy expansion scraper to ensure 100% reply coverage.
- **Image Extraction**: Successfully downloads and maps all images from posts and comments.
