(() => {
    'use strict';

    /* ================= Config ================= */
    const API = { latest: '/api/readings/latest', list: '/api/readings', alerts: '/api/alerts' }; // relative URLs only
    const REFRESH_MS = 5000;
    const STALE_MIN = 10;      // assumption: older than 10 minutes = "may be stale"

    const METRICS = [
        { key: 'ph',          label: 'pH',        dec: 2, color: '#0b8bd9' },
        { key: 'turbidity',   label: 'Turbidity', dec: 2, color: '#d98a0b' },
        { key: 'tds',         label: 'TDS (ppm)', dec: 0, color: '#0e9aa7' },
        { key: 'temperature', label: 'Temp (°C)', dec: 1, color: '#d9480b' }
    ];

    /* ================= State ================= */
    const state = { demo: false, inFlight: false, timer: null, latest: null, list: [], demoList: [], alerts: [], alertsFailed: false, loaded: false, failed: false };
    const charts = {};
    const $ = (id) => document.getElementById(id);

    /* ================= Helpers ================= */
    const pad = (n) => String(n).padStart(2, '0');

    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    // LocalDateTime like "2026-10-22T19:00:00": reformatted as text, no timezone conversion.
    function fmtTs(s) {
        const m = typeof s === 'string' && s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
        return m ? `${m[1]} ${m[2]}` : '--';
    }

    function ageMinutes(s) {
        if (typeof s !== 'string') return null;
        const t = new Date(s).getTime();
        return Number.isFinite(t) ? (Date.now() - t) / 60000 : null;
    }

    function normalize(r) {
        r = r || {};
        return {
            id: r.id ?? null,
            ph: num(r.ph), turbidity: num(r.turbidity), tds: num(r.tds), temperature: num(r.temperature),
            recordedAt: typeof r.recordedAt === 'string' ? r.recordedAt : null
        };
    }

    const fmtVal = (v, dec) => (v === null ? '--' : v.toFixed(dec));
    const setStatus = (el, text, level) => { el.textContent = text; el.dataset.level = level; };

    /* ================= API layer ================= */
    async function getJSON(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
        const text = await res.text();
        if (!text.trim()) return null;
        try { return JSON.parse(text); }
        catch { throw new Error(`Invalid JSON from ${url}`); }
    }

    /* ================= Demo data (browser memory only, never POSTed) ================= */
    function makeDemoData() {
        const out = [], now = Date.now();
        for (let i = 0; i < 30; i++) {
            const d = new Date(now - i * 5 * 60000);
            const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            out.push({
                id: `demo-${30 - i}`,
                ph: 7 + Math.sin(i / 4) * 0.4,
                turbidity: 2.5 + Math.cos(i / 3) * 0.8,
                tds: 320 + Math.sin(i / 5) * 25,
                temperature: 25 + Math.sin(i / 6) * 1.2,
                recordedAt: ts
            });
        }
        return out;
    }

    /* ================= Rendering ================= */
    function renderCards() {
        document.querySelectorAll('.metric').forEach((card) => {
            const m = METRICS.find((x) => x.key === card.dataset.key);
            const v = state.latest ? state.latest[m.key] : null;
            card.querySelector('[data-role="value"]').textContent = fmtVal(v, m.dec);
            const st = card.querySelector('[data-role="state"]');
            if (!state.loaded) setStatus(st, 'Loading…', 'idle');
            else if (v === null) setStatus(st, 'No value', 'warn');
            else setStatus(st, state.demo ? 'Simulated value' : 'Value available', 'ok');
        });
    }

    function renderStatus() {
        const api = $('stApi'), latest = $('stLatest'), fresh = $('stFresh'), side = $('sideStatus');
        if (state.demo) {
            setStatus(api, 'Not used in demo mode', 'idle');
            setStatus(latest, 'Simulated reading', 'warn');
            setStatus(fresh, 'Simulated — not real data', 'warn');
            setStatus(side, 'Demo mode', 'warn');
            $('stTime').textContent = `Last simulated reading: ${fmtTs(state.latest && state.latest.recordedAt)}`;
            return;
        }
        if (!state.loaded && !state.failed) return;
        setStatus(api, state.failed ? 'Unavailable — last request failed' : 'API reachable', state.failed ? 'bad' : 'ok');

        if (!state.latest) {
            setStatus(latest, 'No readings in database', 'warn');
            setStatus(fresh, 'No data', 'idle');
            setStatus(side, 'No readings saved', 'warn');
            $('stTime').textContent = 'Last reading received: --';
            return;
        }
        setStatus(latest, 'Reading available', 'ok');
        const age = ageMinutes(state.latest.recordedAt);
        if (age === null) {
            setStatus(fresh, 'Unknown (invalid timestamp)', 'warn');
            setStatus(side, 'Freshness unknown', 'warn');
        } else if (age <= STALE_MIN) {
            setStatus(fresh, `Recent (${Math.max(0, Math.round(age))} min ago)`, 'ok');
            setStatus(side, 'Recent data received', 'ok');
        } else {
            setStatus(fresh, 'Data may be stale', 'warn');
            setStatus(side, 'Data may be stale', 'warn');
        }
        $('stTime').textContent = `Last reading received: ${fmtTs(state.latest.recordedAt)}`;
    }

    const sortedAsc = (list) => [...list].sort((a, b) => String(a.recordedAt || '').localeCompare(String(b.recordedAt || '')));

    function initCharts() {
        if (typeof Chart === 'undefined') {
            const msg = $('chartMsg');
            msg.hidden = false;
            msg.textContent = 'Charts unavailable: Chart.js could not be loaded (check your internet connection). The rest of the dashboard still works.';
            document.querySelectorAll('.chart-box').forEach((b) => { b.hidden = true; });
            return;
        }
        METRICS.forEach((m) => {
            charts[m.key] = new Chart($('chart-' + m.key), {
                type: 'line',
                data: { labels: [], datasets: [{ label: m.label, data: [], borderColor: m.color, backgroundColor: m.color, borderWidth: 2, pointRadius: 3, tension: 0, spanGaps: false }] },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => i[0].label, label: (c) => `${m.label}: ${c.parsed.y}` } } },
                    scales: {
                        x: { title: { display: true, text: 'Recorded at' }, ticks: { maxTicksLimit: 6, maxRotation: 0, callback(v) { return String(this.getLabelForValue(v)).slice(5, 16); } } },
                        y: { title: { display: true, text: m.label } }
                    }
                }
            });
        });
    }

    function renderCharts() {
        const asc = sortedAsc(state.list), msg = $('chartMsg');
        if (typeof Chart !== 'undefined') {
            msg.hidden = asc.length >= 2;
            msg.textContent = asc.length === 0 ? 'No readings to chart yet.' : 'Only one reading so far — a trend needs at least two.';
        }
        METRICS.forEach((m) => {
            const c = charts[m.key];
            if (!c) return;
            c.data.labels = asc.map((r) => fmtTs(r.recordedAt));
            c.data.datasets[0].data = asc.map((r) => r[m.key]);   // null = gap, never fabricated
            c.update();
        });
    }

    function renderTable() {
        const body = $('tableBody'), msg = $('tableMsg');
        body.replaceChildren();
        if (state.failed && !state.loaded) { msg.hidden = false; msg.textContent = 'Could not load readings. Use Retry above.'; return; }
        if (!state.loaded) { msg.hidden = false; msg.textContent = 'Loading readings…'; return; }
        if (state.list.length === 0) { msg.hidden = false; msg.textContent = 'No readings saved yet. Send one with POST /api/readings.'; return; }
        msg.hidden = true;
        sortedAsc(state.list).reverse().forEach((r) => {
            const tr = document.createElement('tr');
            [r.id === null ? '--' : String(r.id), fmtTs(r.recordedAt)].concat(METRICS.map((m) => fmtVal(r[m.key], m.dec))).forEach((text) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (text === '--') td.className = 'missing';
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    function render() { renderCards(); renderStatus(); renderCharts(); renderTable(); renderAlerts(); }

    /* ================= Alert history ================= */
    function fmtAlertTime(s) {
        if (typeof s !== 'string') return '--';
        const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
        return m ? `${m[1]} ${m[2]}` : '--';
    }

    function renderAlerts() {
        const list = $('alertsList');
        const info = $('alertsInfo');
        if (!list || !info) return;

        list.replaceChildren();

        if (state.demo) {
            info.textContent = 'Demo mode is active. Simulated readings are not sent to the backend and do not create persistent alerts.';
            info.dataset.level = 'warn';
            const item = document.createElement('article');
            item.className = 'card empty';
            const heading = document.createElement('h3');
            heading.textContent = 'No persistent demo alerts';
            const message = document.createElement('p');
            message.className = 'note';
            message.textContent = 'Switch off Demo mode and send a test reading through Postman to exercise backend alert rules.';
            item.append(heading, message);
            list.appendChild(item);
            return;
        }

        if (state.alertsFailed) {
            info.textContent = 'Could not load alert history. Check that Spring Boot is running and retry.';
            info.dataset.level = 'bad';
            return;
        }

        if (!state.alerts.length) {
            info.textContent = 'No data-quality alerts have been recorded yet.';
            info.dataset.level = 'ok';
            const item = document.createElement('article');
            item.className = 'card empty';
            const heading = document.createElement('h3');
            heading.textContent = 'No alerts recorded';
            const message = document.createElement('p');
            message.className = 'note';
            message.textContent = 'Alerts are created when a reading has a missing parameter or a temperature value outside the configured sensor plausibility range.';
            item.append(heading, message);
            list.appendChild(item);
            return;
        }

        info.textContent = `${state.alerts.length} most recent alert record(s) from the database.`;
        info.dataset.level = 'warn';

        state.alerts.forEach((alert) => {
            const article = document.createElement('article');
            article.className = 'alert-item';
            article.dataset.severity = String(alert.severity || 'WARNING').toUpperCase();

            const symbol = document.createElement('div');
            symbol.className = 'alert-symbol';
            symbol.textContent = article.dataset.severity === 'CRITICAL' ? '!' : 'i';

            const content = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'alert-title';
            title.textContent = `${alert.severity || 'WARNING'} · ${alert.parameter || 'Data quality'}`;

            const message = document.createElement('p');
            message.className = 'alert-message';
            message.textContent = alert.message || 'No alert description provided.';

            const code = document.createElement('p');
            code.className = 'note';
            code.textContent = `Code: ${alert.code || 'UNKNOWN'}${alert.readingId == null ? '' : ` · Reading ID: ${alert.readingId}`}`;

            content.append(title, message, code);

            const time = document.createElement('time');
            time.className = 'alert-meta';
            time.textContent = fmtAlertTime(alert.createdAt);
            if (alert.createdAt) time.dateTime = alert.createdAt;

            article.append(symbol, content, time);
            list.appendChild(article);
        });
    }

    async function refreshAlerts() {
        if (state.demo) {
            state.alerts = [];
            state.alertsFailed = false;
            renderAlerts();
            return;
        }

        try {
            const alerts = await getJSON(API.alerts);
            state.alerts = Array.isArray(alerts) ? alerts : [];
            state.alertsFailed = false;
        } catch (err) {
            state.alertsFailed = true;
        }
        renderAlerts();
    }

    /* ================= Errors and busy state ================= */
    const showError = (msg) => { $('errorText').textContent = msg; $('errorBanner').hidden = false; };
    const hideError = () => { $('errorBanner').hidden = true; };
    function setBusy(b) { const btn = $('refreshBtn'); btn.disabled = b; btn.textContent = b ? 'Refreshing…' : 'Refresh'; }

    /* ================= Refresh loop ================= */
    async function refresh() {
        if (state.inFlight) return;
        state.inFlight = true; setBusy(true);
        try {
            if (state.demo) {
                state.list = state.demoList.map(normalize);
                state.latest = state.list[0] || null;
            } else {
                const [latest, list] = await Promise.all([getJSON(API.latest), getJSON(API.list)]);
                state.latest = latest ? normalize(latest) : null;
                state.list = Array.isArray(list) ? list.map(normalize) : [];
            }
            state.loaded = true; state.failed = false;
            $('lastFetch').textContent = new Date().toLocaleTimeString();
            hideError();
        } catch (err) {
            state.failed = true;
            showError(`Could not load data: ${err.message}. Is Spring Boot running on this address?`);
        } finally {
            state.inFlight = false; setBusy(false);
            render();
            refreshAlerts();
        }
    }

    function startPolling() { stopPolling(); state.timer = setInterval(refresh, REFRESH_MS); }
    function stopPolling() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

    function setDemo(on) {
        state.demo = on;
        state.latest = null; state.list = []; state.loaded = false; state.failed = false;   // never mix modes
        if (on) state.demoList = makeDemoData();
        $('demoBanner').hidden = !on;
        $('sourceChip').textContent = on ? 'Source: Simulated (demo)' : 'Source: Database readings';
        hideError(); render(); refresh();
    }

    /* ================= Navigation ================= */
    function initNav() {
        const nav = $('nav'), links = $('navLinks'), btn = $('menuBtn');
        const onScroll = () => nav.classList.toggle('solid', window.scrollY > 20);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        const setMenu = (open) => { links.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
        btn.addEventListener('click', () => setMenu(!links.classList.contains('open')));
        links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    }

    /* ================= Init ================= */
    function init() {
        initNav();
        $('refreshBtn').addEventListener('click', refresh);
        $('retryBtn').addEventListener('click', refresh);
        if ($('alertsRefreshBtn')) $('alertsRefreshBtn').addEventListener('click', refreshAlerts);
        $('demoToggle').addEventListener('change', (e) => setDemo(e.target.checked));
        window.addEventListener('pagehide', stopPolling);
        initCharts();
        render();
        refresh();
        startPolling();
    }

    init();
})();