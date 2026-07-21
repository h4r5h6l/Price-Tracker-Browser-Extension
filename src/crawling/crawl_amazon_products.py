import requests
from scrapling.fetchers import Fetcher, FetcherSession

# stealth mode
from scrapling.fetchers import StealthyFetcher, StealthySession

# for crawls
from scrapling.spiders import Spider, Request, Response

# for storage
# import json
# from datetime import datetime
from storing.saver import save_products
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
products_path = (os.path.join(script_dir, "files/products.json"))
history_path = (os.path.join(script_dir, "files/price_history.json"))


import time

try:
    with StealthySession(
        impersonate="chrome",
        headless=True,
        solve_cloudflare=True,
        extra_headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "de,en-US;q=0.9,en;q=0.8",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "Priority": "u=0, i",
        },
    ) as session:
        base_url = "https://www.amazon.de/s?k=laptop"
        # Fetch the page using the session and loop
        current_url, page_num, max_pages = base_url, 1, 10
        # List to store all products across pages
        all_products = []

        # ============================================================================

        # Parse the page for product details
        while page_num <= max_pages and current_url:
            print(f"Fetching page {page_num}: {current_url}")

            page = session.fetch(current_url, google_search=False)
            if page.status != 200:
                print(f"Failed to fetch page {page_num}: {current_url} (Status code: {page.status})")
                break
            print(f"Page {page_num}")

            # Traversing the page
            product_cards = page.css("div[data-component-type='s-search-result']")
            for cards in product_cards:
                title = cards.css("h2 span::text").get()
                price = cards.css("span.a-price-whole::text").get()
                # pricef = float(price)
                rating = cards.css("span.a-icon-alt::text").get()
                asin = cards.css("::attr(data-asin)").get()
                # print(f"Title: {title}, Price: {price}, Rating: {rating}, Asin: {asin}")
                all_products.append({"title": title, "price": price, "rating": rating, "asin": asin})
            # Saving the metadata of the product
            print(f"Total Items: {len(all_products)} on page {page_num}")

            # Find the next page URL
            # next_page_link = page.css("li.a-last a::attr(href)").get()
            next_page_link = page.css("a.s-pagination-next::attr(href)").get()
            # print("next page link : ", {next_page_link})
            if next_page_link:
                current_url = "https://www.amazon.de" + next_page_link
                page_num += 1
            else:
                current_url = None
            # Sleep for 5 seconds to avoid being blocked
            time.sleep(5)

        # Method from saver.py
        save_products(all_products, products_path, history_path)

except requests.exceptions.HTTPError as e:
    print(f"HTTP error: {e}")
except requests.exceptions.Timeout as e:
    print(f"Request timed out: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")


print(f"Scraped {len(all_products)} products in total.")


# Or use one-off requests
# page = Fetcher.get("https://quotes.toscrape.com/")
# quotes = page.css(".quote .text::text").getall()
