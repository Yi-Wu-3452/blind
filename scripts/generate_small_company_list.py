import pandas as pd
import json
import os

xlsx_path = '/Users/ywu47/Documents/blind/S&P 500 list_Blind_Filtered0214.xlsx'
out_json = '/Users/ywu47/Documents/blind/company_list_under_100.json'

print(f"Reading {xlsx_path}...")
df = pd.read_excel(xlsx_path)

# Filter for companies with < 100 posts
filtered_df = df[df['# Posts'] < 100]

# Prepare data for batch_collect_company_urls.mjs
# It expects: Symbol, Company Name, Post URL
data = filtered_df[['Symbol', 'Company Name', 'Post URL', '# Posts']].to_dict(orient='records')

print(f"Found {len(data)} companies with < 100 posts.")

with open(out_json, 'w') as f:
    json.dump(data, f, indent=2)

print(f"Successfully saved to {out_json}")
