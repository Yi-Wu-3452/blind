#!/bin/bash

# 1. Start SSH Proxy Tunnel (Run this in a separate terminal)
# ssh -D 18080 -N -v ywu47@10.230.100.240

# 2. Run Batch Extraction (Medium Companies)
# caffeinate -d node scripts/core/extract_post_details.mjs --company-list=company_list_100_to_1000.json --auto-login --account 2 --proxy socks5://127.0.0.1:18080 --delay=3000

# 3. Run Batch Extraction (Small Companies)
# caffeinate -d node scripts/core/extract_post_details.mjs --company-list=company_list_under_100.json --auto-login --delay=3000

# caffeinate -d node scripts/core/extract_post_details.mjs --company-list=company_list_1000_to_10K.json --delay=3000 --auto-login --account 2 --proxy socks5://127.0.0.1:18080 --reverse

# node scripts/core/batch_collect_mega_company_tags.mjs

node scripts/core/collect_company_urls_robust.mjs \
  --company=Broadcom \
  --sort=top \
  --out=data/company_post_urls/broadcom/broadcom_top.json \
  --login \
  --account 3 \
  --robust-scroll \
  --scroll-limit=200
