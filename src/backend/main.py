"""FastAPI backend for the Price Tracker Browser Extension.

Provides the /api/price-comparison endpoint that the extension's
price-panel.js content script POSTs to.

Run with:
    cd src/backend && uvicorn main:app --reload --port 8000
"""

from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from product_matcher import build_comparison_response

app = FastAPI(
    title="Price Tracker API",
    description="Backend for the Price Tracker Browser Extension — matches products and returns price comparisons.",
    version="0.1.0",
)


class PriceComparisonRequest(BaseModel):
    """Request body sent by the extension's price-panel.js."""

    asin: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None
    price: Optional[float] = None
    image: Optional[str] = None


@app.get("/")
def root():
    return {"message": "Price Tracker API is running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/price-comparison")
def price_comparison(request: PriceComparisonRequest):
    """Match the incoming product and return comparison data.

    Expected request body (from price-panel.js):
        { asin, url, title, price, image }

    Response body:
        {
          sources:      [{ name, price, url }, ...],
          updatedAt:    ISO timestamp,
          priceHistory: [{ date, price }, ...],
          bestDeals:    [{ date, price }, ...],
          matched:      bool
        }
    """
    if not request.asin and not request.title:
        raise HTTPException(
            status_code=400,
            detail="Either 'asin' or 'title' is required to match a product.",
        )

    response = build_comparison_response(
        asin=request.asin,
        title=request.title,
        current_price=request.price,
    )

    return response