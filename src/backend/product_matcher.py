"""Matches incoming product requests against stored product data and builds
the comparison response expected by the browser extension."""

import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

from data_loader import (
    load_products,
    load_price_history,
    get_product_by_asin,
    get_price_history_for_asin,
)


def normalize_title(title: str) -> str:
    """Lowercase, strip punctuation, and collapse whitespace for fuzzy matching."""
    if not title:
        return ""
    title = title.lower()
    title = re.sub(r"[^a-z0-9\s]", " ", title)
    return re.sub(r"\s+", " ", title).strip()


def title_similarity(a: str, b: str) -> float:
    """Simple token-overlap similarity score between two titles (0.0 - 1.0)."""
    tokens_a = set(normalize_title(a).split())
    tokens_b = set(normalize_title(b).split())
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


def find_matching_product(asin: Optional[str], title: Optional[str]) -> Optional[Dict[str, Any]]:
    """Find a stored product by ASIN first, then by title similarity."""
    # 1. Exact ASIN match
    if asin:
        product = get_product_by_asin(asin)
        if product:
            return product

    # 2. Title similarity match
    if title:
        products = load_products()
        best_match = None
        best_score = 0.0
        for stored_asin, stored_product in products.items():
            score = title_similarity(title, stored_product.get("title", ""))
            if score > best_score:
                best_score = score
                best_match = stored_product
        # Require at least 50% token overlap to consider it a match
        if best_match and best_score >= 0.5:
            return best_match

    return None


def build_price_history(history: Dict[str, float]) -> List[Dict[str, Any]]:
    """Convert {timestamp: price} dict into [{date, price}] list sorted by date."""
    entries = []
    for timestamp, price in history.items():
        try:
            dt = datetime.fromisoformat(timestamp)
        except ValueError:
            continue
        entries.append({"date": dt.date().isoformat(), "price": price})
    entries.sort(key=lambda e: e["date"])
    return entries


def build_best_deals(price_history: List[Dict[str, Any]], num_days: int = 5) -> List[Dict[str, Any]]:
    """Predict 'best upcoming days' based on the lowest historical prices.

    Simple heuristic: find the N lowest prices in history and project them
    onto the next N days as predicted deal days.
    """
    if not price_history:
        return []

    # Take the lowest unique prices from history
    sorted_by_price = sorted(price_history, key=lambda e: e["price"])
    lowest = sorted_by_price[:num_days]

    deals = []
    today = datetime.now().date()
    for i, entry in enumerate(lowest):
        deal_date = today + timedelta(days=i + 1)
        deals.append({"date": deal_date.isoformat(), "price": entry["price"]})
    return deals


def build_sources(product: Dict[str, Any], current_price: Optional[float]) -> List[Dict[str, Any]]:
    """Build the list of retailer sources for the comparison panel.

    Currently only Amazon data is available, so we return Amazon as the sole
    source. This is structured to easily append more retailers later.
    """
    sources = []
    asin = product.get("asin")
    if asin:
        sources.append({
            "name": "Amazon",
            "price": current_price if current_price is not None else 0.0,
            "url": f"https://www.amazon.de/dp/{asin}",
        })
    return sources


def build_comparison_response(
    asin: Optional[str],
    title: Optional[str],
    current_price: Optional[float],
) -> Dict[str, Any]:
    """Main entry point: build the full response for /api/price-comparison."""
    product = find_matching_product(asin, title)

    if not product:
        return {
            "sources": [],
            "updatedAt": datetime.now().isoformat(),
            "priceHistory": [],
            "bestDeals": [],
            "matched": False,
        }

    matched_asin = product.get("asin")
    history = get_price_history_for_asin(matched_asin)
    price_history = build_price_history(history)
    best_deals = build_best_deals(price_history)

    return {
        "sources": build_sources(product, current_price),
        "updatedAt": datetime.now().isoformat(),
        "priceHistory": price_history,
        "bestDeals": best_deals,
        "matched": True,
    }