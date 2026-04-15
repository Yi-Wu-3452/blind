#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── helpers ────────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }
cyan()  { printf '\033[36m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
red()   { printf '\033[31m%s\033[0m' "$*"; }
yellow(){ printf '\033[33m%s\033[0m' "$*"; }

ask() {
    # ask <prompt> <varname> [default]
    local prompt="$1" varname="$2" default="$3"
    local hint=""
    [ -n "$default" ] && hint=" $(dim "[default: $default]")"
    printf '%s%s: ' "$prompt" "$hint"
    read -r "$varname"
    if [ -z "${!varname}" ] && [ -n "$default" ]; then
        eval "$varname=\"$default\""
    fi
}

confirm() {
    printf '%s [y/N] ' "$1"
    read -r _yn
    [[ "$_yn" =~ ^[Yy]$ ]]
}

header() {
    echo ""
    echo "$(bold "$(cyan "══════════════════════════════════════════")")"
    echo "$(bold "$(cyan "  $1")")"
    echo "$(bold "$(cyan "══════════════════════════════════════════")")"
    echo ""
}

section() {
    echo ""
    echo "$(bold "$1")"
    echo "$(dim "──────────────────────────────────────────")"
}

run_cmd() {
    echo ""
    echo "$(dim "> $*")"
    echo ""
    eval "$@"
}

press_enter() {
    echo ""
    printf "$(dim 'Press Enter to return to menu...')"; read -r
}

# ── common option collectors ───────────────────────────────────────────────────

collect_common_opts() {
    # Populates: ACCOUNT EXTRA_OPTS
    EXTRA_OPTS=""
    ask "Account number" ACCOUNT "1"
    [ -n "$ACCOUNT" ] && EXTRA_OPTS="$EXTRA_OPTS --account $ACCOUNT"
}

# ── screens ───────────────────────────────────────────────────────────────────

screen_collect_single() {
    header "Collect URLs — Single Company"
    ask "Company name" COMPANY
    ask "Sort order" SORT "recent"
    collect_common_opts
    LOGIN_FLAG="--login"
    run_cmd node scripts/core/collect_company_urls_robust.mjs \
        --company="\"$COMPANY\"" --sort="$SORT" "$LOGIN_FLAG" $EXTRA_OPTS
    press_enter
}

screen_collect_batch() {
    header "Collect URLs — Batch"
    echo "Company list files:"
    echo "  $(dim "1)") company_list_top_6.json"
    echo "  $(dim "2)") company_list_over_10k.json"
    echo "  $(dim "3)") company_list_1000_to_10K.json"
    echo "  $(dim "4)") company_list_100_to_1000.json"
    echo "  $(dim "5)") company_list_under_100.json"
    echo "  $(dim "6)") Custom path"
    echo ""
    ask "Choice" LIST_CHOICE "3"
    case "$LIST_CHOICE" in
        1) LIST_FILE="company_list_top_6.json" ;;
        2) LIST_FILE="company_list_over_10k.json" ;;
        3) LIST_FILE="company_list_1000_to_10K.json" ;;
        4) LIST_FILE="company_list_100_to_1000.json" ;;
        5) LIST_FILE="company_list_under_100.json" ;;
        6) ask "Path to company list JSON" LIST_FILE ;;
        *) LIST_FILE="company_list_1000_to_10K.json" ;;
    esac
    ask "Limit per company" LIMIT "1000"
    collect_common_opts
    run_cmd node scripts/core/batch_collect_company_urls.mjs \
        --company-list="$LIST_FILE" --limit="$LIMIT" $EXTRA_OPTS
    press_enter
}

screen_collect_mega_tags() {
    header "Collect URLs — Mega Company Tags"
    echo "  $(cyan "t")  Tags only       (default)"
    echo "  $(cyan "r")  Recent only"
    echo "  $(cyan "p")  Top only"
    echo "  $(cyan "a")  All  (tags + recent + top)"
    echo ""
    ask "Collection mode" MODE "t"
    collect_common_opts
    run_cmd node scripts/pick_and_collect_mega.mjs --mode="$MODE" $EXTRA_OPTS
    press_enter
}

screen_extract() {
    header "Extract Post Details"
    echo "Target:"
    echo "  $(dim "1)") Mega companies  (10k+ posts)"
    echo "  $(dim "2)") Large companies (1k–10k posts)"
    echo "  $(dim "3)") Mid companies   (100–1k posts)"
    echo "  $(dim "4)") Small companies (<100 posts)"
    echo "  $(dim "5)") Single company  (by name)"
    echo "  $(dim "6)") Custom company list"
    echo ""
    ask "Choice" EXT_CHOICE "2"
    collect_common_opts
    local AUTO_LOGIN="--auto-login"

    case "$EXT_CHOICE" in
        1) run_cmd node scripts/core/extract_post_details.mjs \
               --company-list=company_list_over_10k.json $AUTO_LOGIN $EXTRA_OPTS ;;
        2) run_cmd node scripts/core/extract_post_details.mjs \
               --company-list=company_list_1000_to_10K.json $AUTO_LOGIN $EXTRA_OPTS ;;
        3) run_cmd node scripts/core/extract_post_details.mjs \
               --company-list=company_list_100_to_1000.json $AUTO_LOGIN $EXTRA_OPTS ;;
        4) run_cmd node scripts/core/extract_post_details.mjs \
               --company-list=company_list_under_100.json $AUTO_LOGIN $EXTRA_OPTS ;;
        5)
            ask "Company name" COMPANY
            run_cmd node scripts/core/extract_post_details.mjs \
                --company="\"$COMPANY\"" $AUTO_LOGIN $EXTRA_OPTS ;;
        6)
            ask "Path to company list JSON" LIST_FILE
            run_cmd node scripts/core/extract_post_details.mjs \
                --company-list="$LIST_FILE" $AUTO_LOGIN $EXTRA_OPTS ;;
        *) echo "$(red 'Invalid choice')" ;;
    esac
    press_enter
}

screen_pick_and_scrape() {
    header "Pick & Scrape (auto-managed runs)"
    echo "  $(dim "1)") Mega companies — collect posts  $(dim "(pick:10k:collect)")"
    echo "  $(dim "2)") Mega companies — scrape posts   $(dim "(pick:10k)")"
    echo "  $(dim "3)") 1k–10k companies — scrape posts $(dim "(pick:1k)")"
    echo ""
    ask "Choice" PS_CHOICE "2"
    collect_common_opts

    case "$PS_CHOICE" in
        1)
            echo ""
            echo "  $(cyan "t")  Tags only       (default)"
            echo "  $(cyan "r")  Recent only"
            echo "  $(cyan "p")  Top only"
            echo "  $(cyan "a")  All  (tags + recent + top)"
            echo ""
            ask "Collection mode" MODE "t"
            run_cmd node scripts/run_awake.mjs node scripts/pick_and_collect_mega.mjs --mode="$MODE" $EXTRA_OPTS ;;
        2) run_cmd node scripts/run_awake.mjs node scripts/pick_and_scrape_mega.mjs $EXTRA_OPTS ;;
        3) run_cmd node scripts/run_awake.mjs node scripts/pick_and_scrape.mjs $EXTRA_OPTS ;;
        *) echo "$(red 'Invalid choice')" ;;
    esac
    press_enter
}

screen_progress() {
    header "Progress Check"
    echo "  $(dim "1)") 1k–10k companies"
    echo "  $(dim "2)") 100–1k companies"
    echo "  $(dim "3)") Missing URLs"
    echo ""
    ask "Choice" PROG_CHOICE "1"
    case "$PROG_CHOICE" in
        1) run_cmd node check_1k_10k_progress.mjs ;;
        2) run_cmd node scripts/check_100_1000_progress.mjs ;;
        3) run_cmd node scripts/find_missing_urls.mjs ;;
        *) echo "$(red 'Invalid choice')" ;;
    esac
    press_enter
}

screen_aggregate() {
    header "Aggregate & Package"
    echo "  $(dim "1)") Aggregate posts for a company list"
    echo "  $(dim "2)") ZIP all company data  (master)"
    echo "  $(dim "3)") Both"
    echo ""
    ask "Choice" AGG_CHOICE "3"
    ask "Company list for aggregation" AGG_LIST "company_list_1000_to_10K.json"
    ask "ZIP output filename" ZIP_OUT "posts_all.zip"

    case "$AGG_CHOICE" in
        1)
            run_cmd node scripts/core/aggregate_company_posts.mjs \
                --company-list="$AGG_LIST" ;;
        2)
            run_cmd node scripts/core/zip_company_data.mjs \
                --master --output="$ZIP_OUT" ;;
        3)
            run_cmd node scripts/core/aggregate_company_posts.mjs \
                --company-list="$AGG_LIST"
            run_cmd node scripts/core/zip_company_data.mjs \
                --master --output="$ZIP_OUT" ;;
        *) echo "$(red 'Invalid choice')" ;;
    esac
    press_enter
}

# ── main menu ─────────────────────────────────────────────────────────────────

main_menu() {
    while true; do
        clear
        echo ""
        echo "$(bold "$(cyan "  TeamBlind Scraper")")"
        echo "$(dim "  ──────────────────────────────────────────")"
        echo ""
        echo "  $(bold "URL Collection")"
        echo "    $(cyan "1")  Single company"
        echo "    $(cyan "2")  Batch (company list)"
        echo "    $(cyan "3")  Mega company tags  $(dim "(10k+ posts)")"
        echo ""
        echo "  $(bold "Extraction")"
        echo "    $(cyan "4")  Extract post details"
        echo "    $(cyan "5")  Pick & scrape  $(dim "(auto-managed)")"
        echo ""
        echo "  $(bold "Reporting & Packaging")"
        echo "    $(cyan "6")  Progress check"
        echo "    $(cyan "7")  Aggregate & ZIP"
        echo ""
        echo "    $(cyan "q")  Quit"
        echo ""
        ask "Select" CHOICE

        case "$CHOICE" in
            1) screen_collect_single ;;
            2) screen_collect_batch ;;
            3) screen_collect_mega_tags ;;
            4) screen_extract ;;
            5) screen_pick_and_scrape ;;
            6) screen_progress ;;
            7) screen_aggregate ;;
            q|Q) echo ""; echo "$(dim 'Bye.')"; echo ""; exit 0 ;;
            *) echo "$(red 'Unknown option')"; sleep 1 ;;
        esac
    done
}

main_menu
