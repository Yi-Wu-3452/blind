# Script Comparison: `test_capture_toplevel.mjs` vs `extract_post_details_optimized.mjs`

Both scripts rely on `extractPostData` for post detail scraping. The difference lies in the orchestration logic **ahead of** that call.

## `test_capture_toplevel.mjs` — Minimal, direct harness

1. **Hardcoded URL** — the target URL is baked into a constant at the top of the file.
2. **Simple browser launch** — `chromium.launch({ headless: false })` with a single custom `userAgent`, nothing else.
3. **No resource blocking** — fonts, analytics, ads, etc. are all loaded normally.
4. **No login step** — goes straight to `page.goto` (anon/cookie-less).
5. **Single navigation** — `page.goto(URL, { waitUntil: "domcontentloaded", referer: "..." })`, then immediately calls `extractPostData`.
6. **Always passes `{ captureTopLevel: true }`** — hardcoded option.
7. **No retry logic** — if it fails, it fails.
8. **No skip-if-exists check** — always runs and overwrites.

## `extract_post_details_optimized.mjs` (`startScraping`) — Production-grade runner

1. **Dynamic URL(s)** — accepts a single URL via CLI arg *or* reads a batch file of URLs.
2. **Configurable browser** — supports `--persistent` (reusable browser profile via `launchPersistentContext`) vs. ephemeral context, plus `--headless` flag.
3. **Resource blocking** — routes are intercepted to abort Google Analytics, GTM, Facebook pixel, and web-font requests for speed.
4. **Optional login** — calls `login(page)` if `SHOULD_LOGIN` is set.
5. **Skip-if-exists** — checks whether the output JSON already exists and skips the URL if so.
6. **Retry loop** — wraps `extractPostData` in a `while (retryCount <= maxRetries)` loop (up to 3 retries).
7. **`--capture-toplevel` is opt-in** — only passes `{ captureTopLevel: true }` when the CLI flag is present.
8. **Per-post file logger** — creates a timestamped log file per URL in a `logs/` subdirectory.

## Summary Table

| Concern | `test_capture_toplevel` | `extract_post_details_optimized` |
|---|---|---|
| URL source | Hardcoded | CLI arg or batch file |
| Browser config | Plain launch, headed | Persistent/ephemeral, headed/headless |
| Resource blocking | None | Analytics, ads, fonts blocked |
| Login | No | Optional |
| Skip existing | No | Yes |
| Retries | None | Up to 3 |
| `captureTopLevel` | Always on | Opt-in via `--capture-toplevel` |

The test script is a **stripped-down, repeat-run lab** for the `captureTopLevel` path, while the optimized script wraps the same core call in a full production pipeline with batching, retries, caching, stealth, and resource optimization.
