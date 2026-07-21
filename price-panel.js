/* ==========================================================================
   Price Comparison Panel — Content Script
   Injects a floating tab + slide-in panel onto an Amazon product page.
   Namespaced with `pcx` to avoid clashing with Amazon's own JS globals.
   ========================================================================== */

(function() {
        'use strict';

        /* ------------------------------------------------------------------
           CONFIG — swap this for your teammate's real backend URL
           ------------------------------------------------------------------ */
        const PCX_CONFIG = {
            endpoint: 'https://your-backend.example.com/api/price-comparison'
        };

        /* ------------------------------------------------------------------
           STEP 1: get info about the product currently being viewed
           ------------------------------------------------------------------ */

        // Extract Company/Brand Name
        function getBrandName() {
            // 1. Try reading from the Brand/Byline link near the title (e.g., "Visit the ASUS Store")
            const bylineEl = document.querySelector('#bylineInfo');
            if (bylineEl) {
                const text = bylineEl.textContent.trim();
                const match = text.match(/(?:Visit the|Brand:)\s*([A-Za-z0-9\s&]+?)(?:\s+Store|\s*$)/i);
                if (match && match[1]) return match[1].trim();
            }

            // 2. Fallback: Search the overview table for the "Brand" field
            const brandRow = Array.from(document.querySelectorAll('#productOverview_feature_div tr, #poExpander tr'))
                .find(row => {
                    const label = row.querySelector('td:first-child, span.a-text-bold');
                    return label && label.textContent.trim().toLowerCase() === 'brand';
                });

            if (brandRow) {
                const valueCell = brandRow.querySelector('td:nth-child(2), span:not(.a-text-bold)');
                if (valueCell) return valueCell.textContent.trim();
            }

            return null;
        }

        // Extract Hardware Specs (focused on Laptops)
        function getHardwareSpecs() {
            const specs = {};

            // Read top Product Overview section (CPU, RAM, Hard Disk, Screen Size, OS, etc.)
            const overviewRows = document.querySelectorAll('#productOverview_feature_div tr, #poExpander tr');
            overviewRows.forEach(row => {
                const keyEl = row.querySelector('td:first-child, span.a-text-bold');
                const valEl = row.querySelector('td:nth-child(2), span:not(.a-text-bold)');

                if (keyEl && valEl) {
                    const key = keyEl.textContent.trim();
                    const val = valEl.textContent.replace(/\s+/g, ' ').trim();
                    if (key && val) specs[key] = val;
                }
            });

            // Read bottom Technical Details table for extra hardware specs
            const techRows = document.querySelectorAll('#techSpec_section_1 tr, #productDetails_techSpec_section_1 tr');
            techRows.forEach(row => {
                const th = row.querySelector('th');
                const td = row.querySelector('td');
                if (th && td) {
                    const key = th.textContent.trim();
                    const val = td.textContent.replace(/\s+/g, ' ').trim();
                    if (key && val && !specs[key]) {
                        specs[key] = val;
                    }
                }
            });

            return specs;
        }

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
                image: imageEl ? imageEl.src : null,
                brand: getBrandName(),
                specs: getHardwareSpecs()
            };
        }

        function toBackendPayload(productInfo) {
            return {
                asin: productInfo.asin,
                url: productInfo.url,
                title: productInfo.title,
                price: productInfo.price,
                image: productInfo.image,
                brand: productInfo.brand,
                specs: productInfo.specs
            };
        }

        /* ------------------------------------------------------------------
           STEP 2: build the DOM (tab + panel) once, reuse it
           ------------------------------------------------------------------ */
        let panelEl, tabEl, bodyListEl, currentBlockEl, updatedEl, graphWrapEl, daysRowEl;
        let chartInstance = null;
        let searchInterval = null;

        function buildUI() {
            tabEl = document.createElement('button');
            tabEl.className = 'pcx-tab';
            tabEl.setAttribute('aria-label', 'Compare prices across websites');
            tabEl.textContent = 'COMPARE PRICES';
            tabEl.addEventListener('click', openPanel);

            panelEl = document.createElement('div');
            panelEl.className = 'pcx-panel';
            panelEl.setAttribute('role', 'dialog');
            panelEl.setAttribute('aria-modal', 'false');
            panelEl.setAttribute('aria-label', 'Price comparison panel');
            panelEl.innerHTML = `
      <style>
        @keyframes pcx-ring {
          0% { transform: rotate(0); }
          15% { transform: rotate(15deg); }
          30% { transform: rotate(-15deg); }
          45% { transform: rotate(10deg); }
          60% { transform: rotate(-10deg); }
          75% { transform: rotate(5deg); }
          100% { transform: rotate(0); }
        }
        .pcx-ring-anim { animation: pcx-ring 0.6s ease-in-out; display: inline-block; }
        .pcx-days-header { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; margin-bottom: 8px; }
        .pcx-days-title { margin: 0 !important; }
        .pcx-bell-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; }
        .pcx-bell-btn:hover { background: #f0f2f5; }
        .pcx-notify-dropdown { display: none; margin-bottom: 10px; background: #f8f9fa; border: 1px solid #ddd; padding: 8px; border-radius: 6px; font-size: 12px; }
        .pcx-notify-dropdown.pcx-show { display: block; }
        .pcx-notify-select { width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc; margin-top: 4px; font-size: 12px; }
      </style>
      <div class="pcx-header">
        <h2>Compare prices</h2>
        <button class="pcx-close" aria-label="Close">&times;</button>
      </div>
      <div class="pcx-body">
        <div class="pcx-current" id="pcxCurrent"></div>
        <p class="pcx-compare-title">Other websites</p>
        <div id="pcxList"></div>
        <p class="pcx-updated" id="pcxUpdated"></p>

        <!-- Best Upcoming Days moved above Price History -->
        <div class="pcx-days-header">
          <p class="pcx-days-title" style="font-weight: 600; font-size: 13px; color: #333;">Best upcoming days</p>
          <button class="pcx-bell-btn" id="pcxBellBtn" title="Get notified on price drop">🔔</button>
        </div>
        
        <div class="pcx-notify-dropdown" id="pcxNotifyDropdown">
          <label for="pcxDateSelect" style="color: #555; font-weight: 500;">Select date to get alert:</label>
          <select class="pcx-notify-select" id="pcxDateSelect"></select>
        </div>

        <div class="pcx-days-row" id="pcxDaysRow"></div>

        <!-- Price History section moved below Best Upcoming Days -->
        <div class="pcx-graph-section">
          <p class="pcx-graph-title">Price history</p>
          <div class="pcx-graph-wrap" id="pcxGraphWrap"></div>
        </div>
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

            const bellBtn = panelEl.querySelector('#pcxBellBtn');
            const notifyDropdown = panelEl.querySelector('#pcxNotifyDropdown');
            bellBtn.addEventListener('click', () => {
                notifyDropdown.classList.toggle('pcx-show');
            });

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

        function renderCurrentProduct(info) {
            const priceHtml = info.price ?
                `<p class="pcx-current-price">$${info.price.toFixed(2)}</p>` :
                '';

            const brandHtml = info.brand ?
                `<p class="pcx-brand" style="font-size: 12px; color: #555; margin: 2px 0 4px 0;"><strong>Brand:</strong> ${escapeHtml(info.brand)}</p>` :
                '';

            let specsHtml = '';
            if (info.specs && Object.keys(info.specs).length > 0) {
                const specItems = Object.entries(info.specs)
                    .map(([k, v]) => `<li style="margin-bottom: 2px;"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`)
                    .join('');

                specsHtml = `
                    <div class="pcx-specs-container" style="margin-top: 8px; font-size: 11px; background: #f8f9fa; padding: 6px 8px; border-radius: 4px; border: 1px solid #e9ecef;">
                        <strong style="display: block; margin-bottom: 4px; color: #333;">Hardware Specs:</strong>
                        <ul style="margin: 0; padding-left: 14px; color: #444;">
                            ${specItems}
                        </ul>
                    </div>`;
            }

            currentBlockEl.innerHTML = `
      ${info.image ? `<img src="${info.image}" alt="">` : ''}
      <div class="pcx-current-info">
        <h3>${escapeHtml(info.title || 'Current product')}</h3>
        ${brandHtml}
        ${priceHtml}
        ${specsHtml}
      </div>`;
    }

    function renderSearching() {
        const sites = ['Best Buy', 'Walmart', 'Target', 'eBay', 'B&H Photo', 'Newegg'];
        let idx = 0;

        bodyListEl.innerHTML = `
      <style>
        @keyframes pcx-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .pcx-searching-container { text-align: center; padding: 30px 0; color: #555; }
        .pcx-spinner { margin: 0 auto 12px; width: 28px; height: 28px; border: 3px solid #f3f3f3; border-top: 3px solid #FF9900; border-radius: 50%; animation: pcx-spin 1s linear infinite; }
        .pcx-search-text { font-size: 14px; margin: 0; font-weight: 500; font-family: sans-serif; }
      </style>
      <div class="pcx-searching-container">
        <div class="pcx-spinner"></div>
        <p id="pcxSearchText" class="pcx-search-text">Searching ${sites[0]}...</p>
      </div>
    `;
        updatedEl.textContent = '';

        const textEl = document.getElementById('pcxSearchText');
        searchInterval = setInterval(() => {
            idx = (idx + 1) % sites.length;
            if (textEl) textEl.textContent = `Searching ${sites[idx]}...`;
        }, 250);
    }

    function stopSearching() {
        if (searchInterval) {
            clearInterval(searchInterval);
            searchInterval = null;
        }
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

        const dateSelect = panelEl.querySelector('#pcxDateSelect');
        dateSelect.innerHTML = `<option value="" disabled selected>-- Choose a discount date --</option>` + 
            bestDeals.map(d => `<option value="${d.date}">${formatShortDate(d.date)} ($${d.price.toFixed(2)})</option>`).join('');

        dateSelect.onchange = () => {
            const selectedDate = dateSelect.value;
            const notifyDropdown = panelEl.querySelector('#pcxNotifyDropdown');
            const bellBtn = panelEl.querySelector('#pcxBellBtn');

            notifyDropdown.classList.remove('pcx-show');
            bellBtn.classList.add('pcx-ring-anim');
            
            setTimeout(() => {
                bellBtn.classList.remove('pcx-ring-anim');
            }, 600);

            console.log(`[price-panel] Notification set for price drop on: ${selectedDate}`);
        };

        daysRowEl.querySelectorAll('.pcx-day-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                daysRowEl.querySelectorAll('.pcx-day-chip').forEach(c => c.classList.remove('pcx-day-active'));
                chip.classList.add('pcx-day-active');
                renderGraph(priceHistory, chip.dataset.date);
            });
        });

        if (priceHistory && priceHistory.length) {
            renderGraph(priceHistory, bestDeals[0].date);
        }
    }

    function formatShortDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    /* Helper function to transform raw timestamp-keyed history records into Chart-compatible array format */
    function formatPriceHistory(rawHistoryRecord) {
        if (!rawHistoryRecord) return [];
        
        // Convert dictionary of {"YYYY-MM-DDTHH:MM:SS...": price} into an array sorted by date
        return Object.entries(rawHistoryRecord)
            .filter(([timestamp, price]) => price !== null && price !== undefined)
            .map(([timestamp, price]) => ({
                date: timestamp.split('T')[0], // Extract YYYY-MM-DD format for chart label
                price: price
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    async function loadComparison() {
        const productInfo = getCurrentProductInfo();
        renderCurrentProduct(productInfo);
        
        renderSearching();
        renderGraphSkeleton();
        daysRowEl.innerHTML = '';

        const payload = toBackendPayload(productInfo);
        console.log('[price-panel] sending product info to backend:', payload);

        const delayDuration = Math.floor(Math.random() * 750) + 500;
        await new Promise(resolve => setTimeout(resolve, delayDuration));

        try {
            const res = await fetch(PCX_CONFIG.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Request failed: ' + res.status);
            const data = await res.json();
            
            stopSearching();
            renderResults(data.sources, data.updatedAt);
            renderDayChips(data.bestDeals, data.priceHistory);
            if (!data.bestDeals || !data.bestDeals.length) renderGraph(data.priceHistory);
        } catch (err) {
            console.warn('[price-panel] comparison fetch failed, using integrated history dataset:', err);
            
            stopSearching();

            // Embedded historical mapping matching dataset structure
            const masterHistoryData = {
                "B0GT65GL58": {
                    "2026-05-24T08:50:14.777526": 560.0, "2026-05-28T01:59:29.490534": 550.0,
                    "2026-05-28T14:15:11.440571": 540.0, "2026-05-29T03:23:13.624463": 580.0,
                    "2026-06-05T10:06:07.438430": 420.0, "2026-06-08T03:39:53.998560": 400.0,
                    "2026-06-16T15:10:44.118957": 410.0, "2026-06-27T13:58:38.458487": 430.0,
                    "2026-07-03T12:58:42.030184": 530.0, "2026-07-13T14:51:46.230083": 530.0
                },
                "B0GT4Y6QRJ": {
                    "2026-05-27T04:28:49.905618": 900.0, "2026-06-05T19:52:54.144068": 710.0,
                    "2026-06-23T10:10:02.150117": 650.0, "2026-07-04T05:43:00.842370": 630.0,
                    "2026-07-10T10:08:37.913006": 680.0, "2026-07-20T13:55:59.395721": 660.0
                }
            };

            // Grab historical data corresponding to current product ASIN (fallback to empty array if not found)
            const rawHistory = (productInfo.asin && masterHistoryData[productInfo.asin]) ? masterHistoryData[productInfo.asin] : buildMockHistory();
            const formattedHistory = formatPriceHistory(rawHistory);
            
            const mockDeals = buildMockDeals();
            
            renderResults(
                [
                    { name: 'Best Buy', price: 94.99, url: '#' },
                    { name: 'Walmart', price: 92.50, url: '#' },
                    { name: 'Target', price: 97.00, url: '#' },
                    { name: 'eBay', price: 91.00, url: '#' }
                ],
                new Date().toISOString()
            );
            
            renderDayChips(mockDeals, formattedHistory);
            if (!mockDeals || !mockDeals.length) {
                renderGraph(formattedHistory);
            }
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

    function initExtension() {
        const productInfo = getCurrentProductInfo();
        if (productInfo && productInfo.asin) {
            buildUI();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExtension);
    } else {
        initExtension();
    }
})();
