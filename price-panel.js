/* find and replace 
this part of the server for the backend to work correctly  

================================================

 endpoint:'http://localhost:8000/api/price-comparison'

===================================================
*/


/* ==========================================================================
   Price Comparison Panel — Content Script
   Injects a floating tab + slide-in panel onto an Amazon product page.
   Namespaced with `pcx` to avoid clashing with Amazon's own JS globals.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     CONFIG — swap this for your teammate's real backend URL
     ------------------------------------------------------------------ */
  const PCX_CONFIG = {
    // Expected request body: { asin, url, title, price }
    // Expected response body:
    //   {
    //     sources: [ { name: "Best Buy", price: 94.99, url: "https://..." }, ... ],
    //     updatedAt: "2026-07-12T18:30:00Z",
    //     priceHistory: [ { date: "2026-06-14", price: 99.99 }, ... ],   // for the graph
    //     bestDeals:   [ { date: "2026-07-16", price: 84.99 }, ... ]      // "nearest days" chips
    //   }
    //
    // NOTE: rendering the graph requires Chart.js. This file assumes it's
    // already loaded on the page (see chart.js CDN <script> tag in demo,
    // or bundle it locally for the real extension — see comment near
    // renderGraph() below for the manifest/CSP implication).
    endpoint: 'http://localhost:8000/api/price-comparison'
 
  
  
  
  
  };

  /* ------------------------------------------------------------------
     STEP 1: get info about the product currently being viewed
     ------------------------------------------------------------------
     DECIDED: frontend scrapes the DOM (confirmed — backend needs
     asin + title + price + image, so it can't just work off a bare URL).
     ------------------------------------------------------------------ */
  function getCurrentProductInfo() {
    const asinMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : null;

    const titleEl = document.querySelector('#productTitle');
    const priceEl = document.querySelector('.a-price .a-offscreen');
    const imageEl = document.querySelector('#landingImage, #imgBlkFront');

    return {
      asin,
      url: window.location.href,
      title: titleEl ? titleEl.textContent.trim() : document.title,
      price: priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) : null,
      image: imageEl ? imageEl.src : null
    };
  }

  /* ------------------------------------------------------------------
     STEP 1b: map scraped fields to whatever keys the backend expects.
     ------------------------------------------------------------------
     Field names on the LEFT are what getCurrentProductInfo() returns.
     Values on the RIGHT are placeholders — once your teammate confirms
     their Python endpoint's expected JSON keys (e.g. snake_case like
     "product_id" instead of "asin"), only this one object needs to change.
     Nothing else in the file needs to know about the rename.
     ------------------------------------------------------------------ */
  function toBackendPayload(productInfo) {
    return {
      asin: productInfo.asin,       // e.g. rename to "product_id" if needed
      url: productInfo.url,         // e.g. rename to "page_url" if needed
      title: productInfo.title,     // e.g. rename to "product_title" if needed
      price: productInfo.price,     // e.g. rename to "current_price" if needed
      image: productInfo.image      // e.g. rename to "image_url" if needed
    };
  }

  /* ------------------------------------------------------------------
     STEP 2: build the DOM (tab + panel) once, reuse it
     ------------------------------------------------------------------ */
  let panelEl, tabEl, bodyListEl, currentBlockEl, updatedEl, graphWrapEl, daysRowEl;
  let chartInstance = null; // holds the Chart.js instance so we can destroy/redraw

  function buildUI() {
    tabEl = document.createElement('button');
    tabEl.className = 'pcx-tab';
    tabEl.setAttribute('aria-label', 'Compare prices across websites');
    tabEl.textContent = 'COMPARE PRICES';
    tabEl.addEventListener('click', openPanel);

    panelEl = document.createElement('div');
    panelEl.className = 'pcx-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-modal', 'false'); // page stays interactive
    panelEl.setAttribute('aria-label', 'Price comparison panel');
    panelEl.innerHTML = `
      <div class="pcx-header">
        <h2>Compare prices</h2>
        <button class="pcx-close" aria-label="Close">&times;</button>
      </div>
      <div class="pcx-body">
        <div class="pcx-current" id="pcxCurrent"></div>
        <p class="pcx-compare-title">Other websites</p>
        <div id="pcxList"></div>
        <p class="pcx-updated" id="pcxUpdated"></p>

        <div class="pcx-graph-section">
          <p class="pcx-graph-title">Price history</p>
          <div class="pcx-graph-wrap" id="pcxGraphWrap"></div>
        </div>

        <p class="pcx-days-title">Best upcoming days</p>
        <div class="pcx-days-row" id="pcxDaysRow"></div>
      </div>
    `;

    panelEl.querySelector('.pcx-close').addEventListener('click', closePanel);
    document.body.appendChild(tabEl);
    document.body.appendChild(panelEl);

    currentBlockEl = panelEl.querySelector('#pcxCurrent');
    bodyListEl = panelEl.querySelector('#pcxList');
    updatedEl = panelEl.querySelector('#pcxUpdated');
    graphWrapEl = panelEl.querySelector('#pcxGraphWrap');
    daysRowEl = panelEl.querySelector('#pcxDaysRow');

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelEl.classList.contains('pcx-open')) closePanel();
    });
  }

  function openPanel() {
    panelEl.classList.add('pcx-open');
    tabEl.classList.add('pcx-hidden');
    loadComparison();
  }

  function closePanel() {
    panelEl.classList.remove('pcx-open');
    tabEl.classList.remove('pcx-hidden');
  }

  /* ------------------------------------------------------------------
     STEP 3: render current product + fetch comparison data
     ------------------------------------------------------------------ */
  function renderCurrentProduct(info) {
    const priceHtml = info.price
      ? `<p class="pcx-current-price">$${info.price.toFixed(2)}</p>`
      : '';
    currentBlockEl.innerHTML = `
      ${info.image ? `<img src="${info.image}" alt="">` : ''}
      <div class="pcx-current-info">
        <h3>${escapeHtml(info.title || 'Current product')}</h3>
        ${priceHtml}
      </div>`;
  }

  function renderSkeleton() {
    bodyListEl.innerHTML = Array(4).fill(`
      <div class="pcx-skel-row">
        <div class="pcx-skel pcx-line1"></div>
        <div class="pcx-skel pcx-line2"></div>
      </div>`).join('');
    updatedEl.textContent = '';
  }

  function renderError() {
    bodyListEl.innerHTML = `
      <div class="pcx-state">
        Couldn't load prices right now.
        <button class="pcx-retry" id="pcxRetry">Retry</button>
      </div>`;
    document.getElementById('pcxRetry').addEventListener('click', loadComparison);
  }

  function renderEmpty() {
    bodyListEl.innerHTML = `<div class="pcx-state">No matches found on other sites.</div>`;
  }

  function renderResults(sources, updatedAt) {
    if (!sources || sources.length === 0) return renderEmpty();

    const lowest = Math.min(...sources.map(s => s.price));
    bodyListEl.innerHTML = sources
      .slice()
      .sort((a, b) => a.price - b.price)
      .map(s => `
        <div class="pcx-row">
          <span class="pcx-site"><span class="pcx-dot"></span>${escapeHtml(s.name)}</span>
          <span>
            <span class="pcx-price ${s.price === lowest ? 'pcx-best' : ''}">
              $${s.price.toFixed(2)}${s.price === lowest ? '<span class="pcx-best-badge">Best</span>' : ''}
            </span>
            ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">View</a>` : ''}
          </span>
        </div>`).join('');

    if (updatedAt) {
      updatedEl.textContent = `Updated ${new Date(updatedAt).toLocaleTimeString()}`;
    }
  }

  /* ------------------------------------------------------------------
     Price history graph (Chart.js)
     ------------------------------------------------------------------
     Requires Chart.js to be loaded on the page/extension context.
     For a real extension: either bundle chart.min.js locally and list it
     in manifest.json's content_scripts "js" array (before this file), or
     add the CDN host to manifest.json's content_security_policy. Content
     scripts can't rely on a page's own <script> tags for this.
     ------------------------------------------------------------------ */
  function renderGraphSkeleton() {
    graphWrapEl.innerHTML = `<div class="pcx-skel pcx-graph-skel"></div>`;
  }

  function renderGraphEmpty() {
    graphWrapEl.innerHTML = `<div class="pcx-state">No price history available.</div>`;
  }

  function renderGraph(priceHistory, highlightDate) {
    if (!priceHistory || priceHistory.length === 0) return renderGraphEmpty();

    if (typeof Chart === 'undefined') {
      graphWrapEl.innerHTML = `<div class="pcx-state">Chart.js not loaded.</div>`;
      return;
    }

    graphWrapEl.innerHTML = `<canvas id="pcxChartCanvas"></canvas>`;
    const ctx = document.getElementById('pcxChartCanvas').getContext('2d');

    if (chartInstance) chartInstance.destroy();

    const labels = priceHistory.map(p => p.date);
    const values = priceHistory.map(p => p.price);
    const highlightIndex = highlightDate ? labels.indexOf(highlightDate) : -1;

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: '#FF9900',
          backgroundColor: 'rgba(255,153,0,0.1)',
          fill: true,
          tension: 0.25,
          pointRadius: labels.map((_, i) => (i === highlightIndex ? 6 : 2)),
          pointBackgroundColor: labels.map((_, i) => (i === highlightIndex ? '#131921' : '#FF9900'))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 9 } } }
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     Nearest-day chips — clicking one highlights that point on the graph
     ------------------------------------------------------------------ */
  function renderDayChips(bestDeals, priceHistory) {
    if (!bestDeals || bestDeals.length === 0) {
      daysRowEl.innerHTML = `<div class="pcx-state">No upcoming deals found.</div>`;
      return;
    }

    daysRowEl.innerHTML = bestDeals.map((d, i) => `
      <button class="pcx-day-chip${i === 0 ? ' pcx-day-active' : ''}" data-date="${d.date}">
        ${formatShortDate(d.date)}
        <span class="pcx-day-price">$${d.price.toFixed(2)}</span>
      </button>
    `).join('');

    daysRowEl.querySelectorAll('.pcx-day-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        daysRowEl.querySelectorAll('.pcx-day-chip').forEach(c => c.classList.remove('pcx-day-active'));
        chip.classList.add('pcx-day-active');
        renderGraph(priceHistory, chip.dataset.date);
      });
    });

    // Highlight the first (soonest) day by default once the graph exists
    if (priceHistory && priceHistory.length) {
      renderGraph(priceHistory, bestDeals[0].date);
    }
  }

  function formatShortDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function loadComparison() {
    const productInfo = getCurrentProductInfo();
    renderCurrentProduct(productInfo);
    renderSkeleton();
    renderGraphSkeleton();
    daysRowEl.innerHTML = '';

    // Visible in DevTools console — confirms exactly what's being sent to the
    // backend before a real endpoint exists. Safe to remove once verified.
    const payload = toBackendPayload(productInfo);
    console.log('[price-panel] sending product info to backend:', payload);

    try {
      const res = await fetch(PCX_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      const data = await res.json();
      renderResults(data.sources, data.updatedAt);
      renderDayChips(data.bestDeals, data.priceHistory);
      if (!data.bestDeals || !data.bestDeals.length) renderGraph(data.priceHistory);
    } catch (err) {
      console.warn('[price-panel] comparison fetch failed, using mock data:', err);
      // Mock fallback so the UI is demoable before the backend is wired up.
      const mockHistory = buildMockHistory();
      const mockDeals = buildMockDeals();
      renderResults(
        [
          { name: 'Best Buy', price: 94.99, url: '#' },
          { name: 'Walmart', price: 92.50, url: '#' },
          { name: 'Target', price: 97.00, url: '#' }
        ],
        new Date().toISOString()
      );
      renderDayChips(mockDeals, mockHistory);
    }
  }

  function buildMockHistory() {
    const history = [];
    const today = new Date();
    for (let i = 20; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      history.push({
        date: d.toISOString().slice(0, 10),
        price: +(85 + Math.random() * 15).toFixed(2)
      });
    }
    return history;
  }

  function buildMockDeals() {
    const deals = [];
    const today = new Date();
    for (let i = 1; i <= 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      deals.push({
        date: d.toISOString().slice(0, 10),
        price: +(79 + Math.random() * 10).toFixed(2)
      });
    }
    return deals;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
