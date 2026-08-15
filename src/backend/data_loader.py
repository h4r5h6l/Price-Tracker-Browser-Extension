"""Loads product and price history data from the crawling JSON files."""

import json
import os
from typing import Dict, Any, Optional

# Paths to the crawling data files (relative to this file)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PRODUCTS_PATH = os.path.join(SCRIPT_DIR, "..", "crawling", "files", "products.json")
HISTORY_PATH = os.path.join(SCRIPT_DIR, "..", "crawling", "files", "price_history.json")


def load_products() -> Dict[str, Dict[str, Any]]:
    """Load all products from products.json keyed by ASIN."""
    try:
        with open(PRODUCTS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def load_price_history() -> Dict[str, Dict[str, float]]:
    """Load price history from price_history.json keyed by ASIN."""
    try:
        with open(HISTORY_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get_product_by_asin(asin: str) -> Optional[Dict[str, Any]]:
    """Return a single product by ASIN, or None if not found."""
    products = load_products()
    return products.get(asin)


def get_price_history_for_asin(asin: str) -> Dict[str, float]:
    """Return price history for a single ASIN, or empty dict."""
    history = load_price_history()
    return history.get(asin, {})