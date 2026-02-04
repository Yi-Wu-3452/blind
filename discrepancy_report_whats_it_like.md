# Discrepancy Report: "What's it like working at OpenAI / NVIDIA / Anthropic"

**Date:** 2026-01-30
**URL:** [https://www.teamblind.com/post/whats-it-like-working-at-openai-nvidia-anthropic-542vktt1](https://www.teamblind.com/post/whats-it-like-working-at-openai-nvidia-anthropic-542vktt1)
**Script Used:** `scripts/core/extract_post_details_greedy_debug.mjs`

## Summary
- **Metadata Comment Count:** 219
- **Scraped Reply Count:** 190
- **Difference:** -29

## Analysis
The debug run confirms that **all identified root comments were fully expanded**. For every root comment found, the number of scraped nested replies matched the expected count (visible + hidden buttons).

### Key Findings
1. **No Partial Thread Failures:** The log shows `Status=OK` for all 44 scraped root threads. This means the scraper successfully clicked all "View X more replies" buttons within the threads it found.
2. **Missing Root Comments:** The discrepancy of 29 comments suggests that **entire root comments** are missing from the scrape.
3. **Potential Causes:**
    - **Deleted Comments:** The metadata count (219) might include deleted comments that are no longer rendered in the DOM.
    - **Top-Level Loading Issue:** The script clicks "View more comments" to load more root threads. If the button text varies (e.g., "Show more comments" vs "View more comments") or if the button fails to appear within the timeout, some root threads might stay hidden.
    - **Hidden/Collapsed Content:** Some comments might be actively hidden by the UI (e.g., "low quality" filters) but still counted in metadata.

## Artifacts
- **Debug Log:** [debug_extraction.log](file:///Users/ywu47/Documents/blind/debug_extraction.log) (Contains detailed execution steps and verification per thread)
- **JSON Output:** [debug_output.json](file:///Users/ywu47/Documents/blind/debug_output.json)

## Recommendation
To bridge the gap, manual inspection of the page compared to the `debug_output.json` content is required to see if visible root comments are missing. If the page visually shows ~190 comments, then the 219 metadata count might simply be stale or include deleted content.
