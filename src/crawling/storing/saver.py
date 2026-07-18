# storing/saver.py
import json
from datetime import datetime

#products_path="../files/products.json"
#history_path = "../files/price_history.json"

def save_products(products, products_path, history_path):

    # opening json file
    try:
        with open(products_path) as pp:
            all_products =json.load(pp)

    except (FileNotFoundError, json.JSONDecodeError):
        all_products = {}

    # opening json file
    try:
        with open(history_path) as hp:
            all_history = json.load(hp)

    except (FileNotFoundError, json.JSONDecodeError):
        all_history = {}

    time_stamp = datetime.now().isoformat()

    # File operations
    for p in products:

        # check for existing data
        asin = p.get("asin")
        if not asin:
            continue

        # --------Products.json--------
        # Add/update product info
        if asin not in all_products:
            all_products[asin] = {
                "title": p["title"],
                "rating": p["rating"],
                "asin": p["asin"],
                "first_seen": time_stamp
            }
        else:
            # Update title/rating in case they changed
            all_products[asin].update({"title": p["title"], "rating": p["rating"]})

        # --------History.json--------
        # appending price to history
        # price = float(p["price"]) if p["price"] else None
        # all_history.append({"asin": asin, "price": price, "scraped_at": now})

        if asin not in all_history:
            all_history[asin] = {
                "price": p["price"],
                "scraped_at": time_stamp
            }
        else:
            # Update title/rating in case they changed
            all_history[asin].update({"price": p["price"], "scraped_at": time_stamp})

    # Save both files
    with open(products_path, "w", encoding="utf-8") as f:
        json.dump(all_products, f, ensure_ascii=False, indent=2)

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(all_history, f, ensure_ascii=False, indent=2)
