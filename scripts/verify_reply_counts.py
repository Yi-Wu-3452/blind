import os
import json

def verify_counts():
    data_dir = "data/posts_greedy"
    if not os.path.exists(data_dir):
        print(f"Directory not found: {data_dir}")
        return

    files = [f for f in os.listdir(data_dir) if f.endswith(".json")]
    files.sort()

    print(f"{'Filename':<60} | {'Meta':<5} | {'Count':<5} | {'Diff':<5}")
    print("-" * 85)

    for filename in files:
        filepath = os.path.join(data_dir, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Metadata count
            meta_count_str = data.get("commentsCount", "0")
            if meta_count_str is None:
                meta_count = 0
            else:
                try:
                    meta_count = int(str(meta_count_str).replace(",", ""))
                except ValueError:
                    meta_count = 0
            
            # Scraped count
            replies = data.get("replies", [])
            scraped_count = 0
            for r in replies:
                scraped_count += 1
                scraped_count += len(r.get("nested", []))
            
            diff = scraped_count - meta_count
            print(f"{filename:<60} | {meta_count:<5} | {scraped_count:<5} | {diff:<5}")
            
        except Exception as e:
            print(f"{filename:<60} | Error: {e}")

if __name__ == "__main__":
    verify_counts()
