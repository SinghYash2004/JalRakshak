(() => {
    'use strict';

    /* ================= Config ================= */
    const API = {
        latest: '/api/readings/latest',
        list: '/api/readings',
        alerts: '/api/alerts'
    };

    const REFRESH_MS = 5000;
    const STALE_MIN = 10;
    const TEST_ALERT_VISIBLE_MS = 30000;
    const DISMISS_STORE_KEY = 'jalrakshak.dismissedAlerts.v1';
    const MAX_DISMISSED = 200;

    const METRICS = [
        { key: 'ph', label: 'pH', dec: 2, color: '#0b8bd9' },
        { key: 'turbidity', label: 'Turbidity', dec: 2, color: '#d98a0b' },
        { key: 'tds', label: 'TDS (ppm)', dec: 0, color: '#0e9aa7' },
        { key: 'temperature', label: 'Temp (°C)', dec: 1, color: '#d9480b' }
    ];

    const TIER_RANK = { critical: 3, warning: 2, info: 1 };

    /* ================= State ================= */
    const state = {
        demo: false,
        inFlight: false,
        timer: null,
        latest: null,
        list: [],
        demoList: [],
        alerts: [],
        alertsFailed: false,
        alertsLoadedOnce: false,
        loaded: false,
        failed: false,

        // Acknowledged alert keys (hides the overlay only; nothing is deleted server-side).
        dismissed: loadDismissed(),
        // TEST_ alerts have no readingId, so we remember when we first saw each one.
        testSeen: new Map(),
        overlayOpen: false,
        overlaySig: '',
        lastFocus: null,
        closing: false,
        hasShownOverlay: false,
        seenAlertKeys: new Set(),
        freshTimer: null
    };

    const charts = {};
    if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = '"Manrope", "Segoe UI", system-ui, sans-serif';
    }
    const $ = (id) => document.getElementById(id);
    const pad = (n) => String(n).padStart(2, '0');

    /* ================= Helpers ================= */
    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function fmtTs(s) {
        const m = typeof s === 'string' &&
            s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);

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
            ph: num(r.ph),
            turbidity: num(r.turbidity),
            tds: num(r.tds),
            temperature: num(r.temperature),
            mlPrediction: typeof r.mlPrediction === 'string' ? r.mlPrediction : null,
            recordedAt: typeof r.recordedAt === 'string'
                ? r.recordedAt
                : null
        };
    }

    const fmtVal = (v, dec) => v === null ? '--' : v.toFixed(dec);

    const setStatus = (el, text, level) => {
        if (!el) return;
        el.textContent = text;
        el.dataset.level = level;
    };

    const setText = (id, text) => {
        const el = $(id);
        if (el) el.textContent = text;
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /* ================= API ================= */
    async function getJSON(url) {
        const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} from ${url}`);
        }

        const text = await res.text();

        if (!text.trim()) return null;

        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`Invalid JSON from ${url}`);
        }
    }

    // Never rejects: the alert API failing must not break the dashboard.
    function fetchAlerts() {
        if (state.demo) return Promise.resolve({ ok: true, data: [] });

        return getJSON(API.alerts).then(
            (data) => ({ ok: true, data }),
            () => ({ ok: false, data: null })
        );
    }

    function applyAlerts(result) {
        if (result && result.ok) {
            const alerts = Array.isArray(result.data) ? result.data : [];

            trackTestAlerts(alerts, !state.alertsLoadedOnce);

            state.alerts = alerts;
            state.alertsFailed = false;
            state.alertsLoadedOnce = true;
        } else {
            state.alertsFailed = true;
        }
    }

    /* ================= Demo data ================= */
    function makeDemoData() {
        const out = [];
        const now = Date.now();

        for (let i = 0; i < 30; i++) {
            const d = new Date(now - i * 5 * 60000);

            const ts =
                `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
                `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

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

    /* ================= Metric cards ================= */
    function renderCards() {
        document.querySelectorAll('.metric').forEach((card) => {
            const metric = METRICS.find(
                (m) => m.key === card.dataset.key
            );

            if (!metric) return;

            const value = state.latest
                ? state.latest[metric.key]
                : null;

            const valueEl = card.querySelector('[data-role="value"]');
            const statusEl = card.querySelector('[data-role="state"]');

            if (valueEl) {
                valueEl.textContent = fmtVal(value, metric.dec);
            }

            if (!state.loaded) {
                setStatus(statusEl, 'Loading…', 'idle');
            } else if (value === null) {
                setStatus(statusEl, 'No value', 'warn');
            } else {
                setStatus(
                    statusEl,
                    state.demo ? 'Simulated value' : 'Value available',
                    'ok'
                );
            }
        });
    }

    /* ================= Connection status ================= */
    function renderStatus() {
        const api = $('stApi');
        const latest = $('stLatest');
        const fresh = $('stFresh');
        const side = $('sideStatus');

        if (state.demo) {
            setStatus(api, 'Not used in demo mode', 'idle');
            setStatus(latest, 'Simulated reading', 'warn');
            setStatus(fresh, 'Simulated — not real data', 'warn');
            setStatus(side, 'Demo mode', 'warn');

            if ($('stTime')) {
                $('stTime').textContent =
                    `Last simulated reading: ${fmtTs(state.latest?.recordedAt)}`;
            }

            return;
        }

        if (!state.loaded && !state.failed) return;

        setStatus(
            api,
            state.failed ? 'Unavailable — last request failed' : 'API reachable',
            state.failed ? 'bad' : 'ok'
        );

        if (!state.latest) {
            setStatus(latest, 'No readings in database', 'warn');
            setStatus(fresh, 'No data', 'idle');
            setStatus(side, 'No readings saved', 'warn');

            if ($('stTime')) {
                $('stTime').textContent = 'Last reading received: --';
            }

            return;
        }

        setStatus(latest, 'Reading available', 'ok');

        const age = ageMinutes(state.latest.recordedAt);

        if (age === null) {
            setStatus(fresh, 'Unknown (invalid timestamp)', 'warn');
            setStatus(side, 'Freshness unknown', 'warn');
        } else if (age <= STALE_MIN) {
            setStatus(
                fresh,
                `Recent (${Math.max(0, Math.round(age))} min ago)`,
                'ok'
            );
            setStatus(side, 'Recent data received', 'ok');
        } else {
            setStatus(fresh, 'Data may be stale', 'warn');
            setStatus(side, 'Data may be stale', 'warn');
        }

        if ($('stTime')) {
            $('stTime').textContent =
                `Last reading received: ${fmtTs(state.latest.recordedAt)}`;
        }
    }

    const sortedAsc = (list) =>
        [...list].sort((a, b) =>
            String(a.recordedAt || '').localeCompare(
                String(b.recordedAt || '')
            )
        );

    /* ================= Charts ================= */
    function initCharts() {
        if (typeof Chart === 'undefined') {
            const msg = $('chartMsg');

            if (msg) {
                msg.hidden = false;
                msg.textContent =
                    'Charts unavailable: Chart.js could not be loaded. The rest of the dashboard still works.';
            }

            document.querySelectorAll('.chart-box').forEach((box) => {
                box.hidden = true;
            });

            return;
        }

        METRICS.forEach((metric) => {
            const canvas = $('chart-' + metric.key);
            if (!canvas) return;

            charts[metric.key] = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: metric.label,
                        data: [],
                        borderColor: metric.color,
                        backgroundColor: metric.color,
                        borderWidth: 2,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        tension: 0,
                        spanGaps: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#04162b',
                            titleColor: '#bff3f8',
                            bodyColor: '#fff',
                            padding: 10,
                            cornerRadius: 8,
                            displayColors: false,
                            callbacks: {
                                title: (items) => items[0].label,
                                label: (context) =>
                                    `${metric.label}: ${context.parsed.y}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Recorded at', color: '#4f6275' },
                            grid: { display: false },
                            ticks: {
                                color: '#4f6275',
                                maxTicksLimit: 6,
                                maxRotation: 0,
                                callback(value) {
                                    return String(
                                        this.getLabelForValue(value)
                                    ).slice(5, 16);
                                }
                            }
                        },
                        y: {
                            grid: { color: 'rgba(15, 34, 54, .07)' },
                            ticks: { color: '#4f6275' },
                            title: {
                                display: true,
                                text: metric.label,
                                color: '#4f6275'
                            }
                        }
                    }
                }
            });
        });
    }

    function renderCharts() {
        const ascending = sortedAsc(state.list);
        const msg = $('chartMsg');

        if (typeof Chart !== 'undefined' && msg) {
            msg.hidden = ascending.length >= 2;
            msg.textContent = ascending.length === 0
                ? 'No readings to chart yet.'
                : 'Only one reading so far — a trend needs at least two.';
        }

        METRICS.forEach((metric) => {
            const chart = charts[metric.key];
            if (!chart) return;

            chart.data.labels = ascending.map(
                (reading) => fmtTs(reading.recordedAt)
            );

            chart.data.datasets[0].data = ascending.map(
                (reading) => reading[metric.key]
            );

            chart.update();
        });
    }

    /* ================= ML assessment ================= */
    function renderAssessment() {
        const card = $('assessment');
        const label = $('assessState');
        if (!card || !label) return;

        card.dataset.level = 'idle';

        if (state.demo) {
            label.textContent = 'Demo mode — no ML prediction';
            card.dataset.level = 'idle';
            return;
        }

        if (state.failed && !state.loaded) {
            label.textContent = 'Prediction unavailable — API error';
            card.dataset.level = 'bad';
            return;
        }

        const prediction = state.latest?.mlPrediction;
        if (prediction === 'Safe') {
            label.textContent = 'Model prediction: Safe';
            card.dataset.level = 'ok';
        } else if (prediction === 'Unsafe') {
            label.textContent = 'Model prediction: Unsafe';
            card.dataset.level = 'bad';
        } else {
            label.textContent = state.latest
                ? 'No ML prediction stored for this reading'
                : 'ML prediction not available';
            card.dataset.level = 'idle';
        }
    }

    /* ================= Reading history table ================= */
    function renderTable() {
        const body = $('tableBody');
        const msg = $('tableMsg');

        if (!body || !msg) return;

        body.replaceChildren();

        if (state.failed && !state.loaded) {
            msg.hidden = false;
            msg.textContent = 'Could not load readings. Use Retry above.';
            return;
        }

        if (!state.loaded) {
            msg.hidden = false;
            msg.textContent = 'Loading readings…';
            return;
        }

        if (state.list.length === 0) {
            msg.hidden = false;
            msg.textContent =
                'No readings saved yet. Send one with POST /api/readings.';
            return;
        }

        msg.hidden = true;

        sortedAsc(state.list).reverse().forEach((reading) => {
            const row = document.createElement('tr');

            const values = [
                reading.id === null ? '--' : String(reading.id),
                fmtTs(reading.recordedAt),
                ...METRICS.map((metric) =>
                    fmtVal(reading[metric.key], metric.dec)
                ),
                reading.mlPrediction || '--'
            ];

            values.forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;

                if (value === '--') {
                    cell.className = 'missing';
                }

                row.appendChild(cell);
            });

            body.appendChild(row);
        });
    }

    function render() {
        renderCards();
        renderAssessment();
        renderStatus();
        renderCharts();
        renderTable();
        renderAlerts();
        renderLiveAlert();
    }

    /* ================= Alert model helpers ================= */
    function fmtAlertTime(s) {
        return fmtTs(s);
    }

    // Preserves the backend's severity label; only the *styling tier* is mapped.
    function severityInfo(raw) {
        const label = typeof raw === 'string' && raw.trim()
            ? raw.trim().toUpperCase()
            : 'UNSPECIFIED';

        let tier = 'warning';
        if (label === 'CRITICAL') tier = 'critical';
        else if (label === 'INFO' || label === 'INFORMATION' || label === 'NOTICE') tier = 'info';

        return { label, tier };
    }

    const isTestAlert = (alert) =>
        alert.readingId == null &&
        String(alert.code || '').toUpperCase().startsWith('TEST_');

    const alertKey = (alert) =>
        `${alert.id ?? alert.code ?? 'alert'}:${alert.readingId ?? ''}:${alert.createdAt ?? ''}`;

    /* ---- Acknowledged (dismissed) alerts, kept per browser tab ---- */
    function loadDismissed() {
        try {
            const raw = sessionStorage.getItem(DISMISS_STORE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr.map(String) : []);
        } catch {
            return new Set();
        }
    }

    function saveDismissed() {
        try {
            const arr = [...state.dismissed].slice(-MAX_DISMISSED);
            sessionStorage.setItem(DISMISS_STORE_KEY, JSON.stringify(arr));
        } catch {
            /* storage unavailable: dismissal still works for this page load */
        }
    }

    /* ---- TEST_ alerts have no readingId, so track when each first appears ---- */
    function trackTestAlerts(alerts, isFirstLoad) {
        alerts.forEach((alert) => {
            if (!isTestAlert(alert)) return;

            const key = alertKey(alert);

            if (!state.testSeen.has(key)) {
                // Alerts already in the DB when the page opened are history, not new.
                state.testSeen.set(key, isFirstLoad ? null : Date.now());
            }
        });
    }

    function isTestAlertFresh(alert, now) {
        const seenAt = state.testSeen.get(alertKey(alert));

        if (seenAt != null && now - seenAt <= TEST_ALERT_VISIBLE_MS) return true;

        const created = typeof alert.createdAt === 'string'
            ? new Date(alert.createdAt).getTime()
            : NaN;

        return Number.isFinite(created) &&
            now >= created &&
            now - created <= TEST_ALERT_VISIBLE_MS;
    }

    /* ---- The one rule: only alerts for the latest reading (plus fresh TEST_ alerts) ---- */
    function getCurrentReadingAlerts() {
        if (state.demo) return [];

        const latestId = state.latest ? state.latest.id : null;
        const now = Date.now();

        return state.alerts
            .filter((alert) => {
                if (alert.readingId != null) {
                    return latestId != null &&
                        String(alert.readingId) === String(latestId);
                }

                return isTestAlert(alert) && isTestAlertFresh(alert, now);
            })
            .sort((a, b) =>
                (TIER_RANK[severityInfo(b.severity).tier] || 0) -
                (TIER_RANK[severityInfo(a.severity).tier] || 0) ||
                String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            );
    }

    /* ================= Alert history (existing section) ================= */
    function renderAlerts() {
        const list = $('alertsList');
        const info = $('alertsInfo');

        if (!list || !info) return;

        list.replaceChildren();

        if (state.demo) {
            info.textContent =
                'Demo mode is active. Simulated readings do not create persistent alerts.';
            info.dataset.level = 'warn';

            const item = el('article', 'card empty');
            item.append(
                el('h3', '', 'No persistent demo alerts'),
                el('p', 'note', 'Switch off Demo mode and send a test reading through Postman to exercise backend alert rules.')
            );
            list.appendChild(item);
            return;
        }

        if (state.alertsFailed) {
            info.textContent =
                'Could not load alert history. Check that Spring Boot is running and retry.';
            info.dataset.level = 'bad';
            return;
        }

        if (state.alerts.length === 0) {
            info.textContent = 'No data-quality alerts have been recorded yet.';
            info.dataset.level = 'ok';

            const item = el('article', 'card empty');
            item.append(
                el('h3', '', 'No alerts recorded'),
                el('p', 'note', 'Alerts are created when a reading has a missing parameter or a temperature value outside the configured sensor plausibility range.')
            );
            list.appendChild(item);
            return;
        }

        const testCount = state.alerts.filter(isTestAlert).length;
        const linkedCount = state.alerts.filter((alert) => !isTestAlert(alert)).length;
        info.textContent = testCount > 0
            ? `${state.alerts.length} recent alert record(s): ${linkedCount} reading-linked data-quality alert(s) and ${testCount} TEST MODE record(s). TEST MODE records are historical test entries, not active alerts for the latest reading.`
            : `${state.alerts.length} recent reading-linked data-quality alert record(s) from the database.`;
        info.dataset.level = testCount > 0 && linkedCount === 0 ? 'idle' : 'warn';

        state.alerts.forEach((alert) => {
            const sev = severityInfo(alert.severity);

            const article = el('article', 'alert-item');
            article.dataset.severity = sev.label;
            article.dataset.tier = sev.tier;

            const symbol = el('div', 'alert-symbol', sev.tier === 'info' ? 'i' : '!');
            symbol.setAttribute('aria-hidden', 'true');

            const content = document.createElement('div');

            const title = el(
                'div',
                'alert-title',
                `${sev.label} · ${alert.parameter || 'Data quality'}`
            );

            if (isTestAlert(alert)) {
                title.appendChild(el('span', 'alert-tag', 'TEST MODE'));
            }

            const message = el(
                'p',
                'alert-message',
                alert.message || 'No alert description provided.'
            );

            const code = el(
                'p',
                'note',
                `Code: ${alert.code || 'UNKNOWN'}` +
                (alert.readingId == null
                    ? ' · Not linked to a sensor reading'
                    : ` · Reading ID: ${alert.readingId}`)
            );

            content.append(title, message, code);

            const time = el('time', 'alert-meta', fmtAlertTime(alert.createdAt));
            if (alert.createdAt) time.dateTime = alert.createdAt;

            article.append(symbol, content, time);
            list.appendChild(article);
        });
    }

    async function refreshAlerts() {
        applyAlerts(await fetchAlerts());
        renderAlerts();
        renderLiveAlert();
    }

    /* ================= Live alert status strip + full-screen overlay ================= */
    function renderAlertStatus(current, fresh) {
        const box = $('alertStatus');
        if (!box) return;

        const icon = $('alertStatusIcon');
        const btn = $('reopenAlertBtn');

        let st = 'idle';
        let title = '';
        let text = '';
        let sym = '•';
        let showBtn = false;

        const latestId = state.latest && state.latest.id != null ? state.latest.id : null;

        if (state.demo) {
            st = 'demo';
            title = 'Alert monitoring is off in demo mode';
            text = 'Simulated readings never create alerts. Switch off Demo mode to see backend alerts.';
        } else if (!state.loaded && !state.failed) {
            st = 'idle';
            title = 'Checking for alerts…';
            text = 'Waiting for the first response from the backend.';
        } else if ((state.failed && !state.loaded) || (state.alertsFailed && current.length === 0)) {
            st = 'error';
            sym = '!';
            title = 'Alert status unavailable';
            text = 'The backend could not be reached, so alerts for the current reading cannot be confirmed right now.';
        } else if (current.length === 0) {
            if (!state.latest) {
                st = 'idle';
                title = 'No reading to check';
                text = 'No readings are saved yet, so no alerts can be linked to a current reading.';
            } else {
                st = 'ok';
                sym = '✓';
                title = 'NO ACTIVE ALERTS';
                const historicalTestCount = state.alerts.filter(isTestAlert).length;
                text = `No active backend alerts are linked to the latest reading${latestId != null ? ` (ID ${latestId})` : ''}. This status checks data-quality alerts only, not water safety.`;
                if (historicalTestCount > 0) text += ` ${historicalTestCount} historical TEST MODE record(s) appear in Alert history; they are not linked to this reading.`;
            }
        } else {
            const top = severityInfo(current[0].severity);
            const realCount = current.filter((a) => !isTestAlert(a)).length;
            const testCount = current.length - realCount;

            st = top.tier;
            sym = top.tier === 'info' ? 'i' : '!';
            title = `${current.length} ACTIVE ALERT${current.length > 1 ? 'S' : ''} · ${top.label}`;

            if (realCount > 0) {
                text = `Linked to the latest reading${latestId != null ? ` (ID ${latestId})` : ''}.`;
                if (testCount > 0) text += ` Includes ${testCount} TEST MODE alert(s).`;
            } else {
                text = 'These are TEST MODE records from the backend test endpoint, not alerts linked to the latest sensor reading.';
            }

            if (fresh.length === 0) text += ' Acknowledged.';
            showBtn = fresh.length === 0;
        }

        box.dataset.state = st;
        if (icon) icon.textContent = sym;
        setText('alertStatusTitle', title);
        setText('alertStatusText', text);
        if (btn) btn.hidden = !showBtn;
    }

    function formatAge(min) {
        if (min < 1) return 'less than a minute';

        const m = Math.round(min);
        if (m < 60) return `approximately ${m} minute${m === 1 ? '' : 's'}`;

        const h = Math.floor(m / 60);
        const r = m % 60;
        if (h < 24) {
            return `approximately ${h} hour${h === 1 ? '' : 's'}` +
                (r ? ` ${r} minute${r === 1 ? '' : 's'}` : '');
        }

        const d = Math.floor(h / 24);
        return `approximately ${d} day${d === 1 ? '' : 's'}`;
    }

    // Age is always computed from the reading's own timestamp.
    function updateFreshness() {
        const box = $('currentAlertFresh');
        const text = $('currentAlertFreshText');
        if (!box || !text) return;

        const rec = state.latest ? state.latest.recordedAt : null;
        const age = ageMinutes(rec);

        let msg;
        let tone;

        if (!state.latest) {
            msg = 'No sensor reading is available to compare against.';
            tone = 'unknown';
        } else if (age === null) {
            msg = 'The age of the latest reading could not be determined.';
            tone = 'unknown';
        } else {
            const a = Math.max(0, age);
            msg = `The latest reading is ${formatAge(a)} old.`;
            tone = a > STALE_MIN ? 'stale' : 'recent';
        }

        if (state.failed || state.alertsFailed) {
            msg += ' Connection issue: showing the last data received.';
            tone = 'stale';
        }

        text.textContent = msg;
        box.dataset.tone = tone;
    }

    function metaItem(label, value, asCode) {
        const row = el('div', 'ca-meta-item');
        const dt = el('dt', '', label);
        const dd = document.createElement('dd');

        if (asCode) dd.appendChild(el('code', '', value));
        else dd.textContent = value;

        row.append(dt, dd);
        return row;
    }

    function buildOverlay(current, animate) {
        const overlay = $('currentAlertOverlay');
        const items = $('currentAlertItems');

        if (!overlay || !items) return;

        const top = severityInfo(current[0].severity);
        const testCount = current.filter(isTestAlert).length;
        const realCount = current.length - testCount;

        overlay.dataset.severity = top.tier;

        setText(
            'currentAlertStatus',
            `${current.length} Alert${current.length > 1 ? 's' : ''} Detected`
        );

        const testBadge = $('currentAlertTestBadge');
        if (testBadge) testBadge.hidden = testCount === 0;

        let summary;
        if (realCount > 0 && testCount === 0) {
            summary = 'Backend alerts linked to the latest reading.';
        } else if (realCount === 0) {
            summary = 'TEST MODE: alerts from the backend test endpoint, not linked to a sensor reading.';
        } else {
            summary = `Backend alerts linked to the latest reading, plus ${testCount} TEST MODE alert${testCount > 1 ? 's' : ''}.`;
        }
        setText('currentAlertSummary', summary);

        const latest = state.latest;
        setText('caReadingId', latest && latest.id != null ? String(latest.id) : '--');
        setText('caRecorded', latest ? fmtTs(latest.recordedAt) : '--');
        setText('caCount', String(current.length));

        const newest = current
            .map((a) => a.createdAt)
            .filter((t) => typeof t === 'string')
            .sort()
            .pop();
        setText('caRaised', fmtAlertTime(newest));

        updateFreshness();

        items.replaceChildren();

        current.forEach((alert, index) => {
            const key = alertKey(alert);
            const sev = severityInfo(alert.severity);
            const test = isTestAlert(alert);
            const isNew = state.hasShownOverlay && !state.seenAlertKeys.has(key);

            const card = el(
                'article',
                'current-alert-item' + (animate ? ' enter' : '') + (isNew ? ' is-new' : '')
            );
            card.dataset.severity = sev.tier;
            card.style.setProperty('--i', String(index));

            const head = el('div', 'current-alert-item-head');
            head.appendChild(el('h3', '', alert.parameter || 'Unspecified parameter'));

            const badges = el('div', 'current-alert-item-badges');
            const sevBadge = el('span', 'ca-badge', sev.label);
            sevBadge.dataset.sev = sev.tier;
            badges.appendChild(sevBadge);

            if (test) {
                badges.append(' ', el('span', 'ca-badge ca-test', 'TEST MODE'));
            }

            head.appendChild(badges);

            const desc = el(
                'p',
                'current-alert-desc',
                alert.message || 'An issue was detected for this reading.'
            );

            const meta = el('dl', 'current-alert-meta');
            meta.append(
                metaItem('Alert code', alert.code || 'UNKNOWN_ALERT', true),
                metaItem(
                    'Reading association',
                    alert.readingId != null
                        ? `Reading ID ${alert.readingId}`
                        : 'Not linked to a sensor reading'
                ),
                metaItem('Raised', fmtAlertTime(alert.createdAt))
            );

            card.append(head, desc, meta);
            items.appendChild(card);
        });

        current.forEach((a) => state.seenAlertKeys.add(alertKey(a)));
        state.hasShownOverlay = true;
    }

    function setBackgroundInert(on) {
        document.querySelectorAll('header.nav, main, footer.foot').forEach((node) => {
            node.inert = on;
        });
    }

    function openOverlay() {
        const overlay = $('currentAlertOverlay');
        if (!overlay || state.overlayOpen) return;

        state.lastFocus = document.activeElement;
        state.overlayOpen = true;

        overlay.hidden = false;
        overlay.scrollTop = 0;
        document.body.classList.add('alert-open');
        setBackgroundInert(true);

        const btn = $('dismissCurrentAlert');
        if (btn) btn.focus({ preventScroll: true });
    }

    function closeOverlay() {
        const overlay = $('currentAlertOverlay');
        if (!overlay || !state.overlayOpen) return;

        state.overlayOpen = false;
        state.overlaySig = '';

        overlay.hidden = true;
        document.body.classList.remove('alert-open');
        setBackgroundInert(false);

        const back = state.lastFocus;
        state.lastFocus = null;

        if (back && typeof back.focus === 'function' && document.contains(back)) {
            back.focus({ preventScroll: true });
        }
    }

    function renderLiveAlert() {
        const current = getCurrentReadingAlerts();
        const fresh = current.filter((a) => !state.dismissed.has(alertKey(a)));

        renderAlertStatus(current, fresh);

        // Nothing new to show (no alerts for the latest reading, or all acknowledged).
        if (fresh.length === 0) {
            closeOverlay();
            return;
        }

        // Rebuild only when the alert set changes, so 5-second polling never
        // restarts the animation, steals focus, or "reopens" the same alert.
        const sig = current
            .map((a) => `${alertKey(a)}|${a.severity}|${a.message}|${a.parameter}`)
            .sort()
            .join('\n');

        if (!state.overlayOpen || sig !== state.overlaySig) {
            buildOverlay(current, !state.overlayOpen);
            state.overlaySig = sig;
        }

        openOverlay();
        updateFreshness();
    }

    function commitDismiss() {
        getCurrentReadingAlerts().forEach((a) => state.dismissed.add(alertKey(a)));
        saveDismissed();

        const overlay = $('currentAlertOverlay');
        const btn = $('dismissCurrentAlert');

        state.closing = false;
        if (overlay) overlay.classList.remove('is-closing');
        if (btn) {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
        }

        renderLiveAlert();
    }

    // Hides the screen only. No request is sent; the alert record is untouched.
    function dismissCurrentAlerts() {
        if (state.closing) return;

        const overlay = $('currentAlertOverlay');

        if (!state.overlayOpen || !overlay) {
            commitDismiss();
            return;
        }

        state.closing = true;

        const btn = $('dismissCurrentAlert');
        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
        }

        overlay.classList.add('is-closing');

        const reduce = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        setTimeout(commitDismiss, reduce ? 0 : 230);
    }

    function reopenCurrentAlerts() {
        getCurrentReadingAlerts().forEach((a) => state.dismissed.delete(alertKey(a)));
        saveDismissed();
        renderLiveAlert();
    }

    /* ================= Error and busy state ================= */
    const showError = (message) => {
        if ($('errorText')) $('errorText').textContent = message;
        if ($('errorBanner')) $('errorBanner').hidden = false;
    };

    const hideError = () => {
        if ($('errorBanner')) $('errorBanner').hidden = true;
    };

    function setBusy(busy) {
        const btn = $('refreshBtn');
        if (!btn) return;

        btn.disabled = busy;
        btn.textContent = busy ? 'Refreshing…' : 'Refresh';
    }

    /* ================= Refresh loop ================= */
    async function refresh() {
        if (state.inFlight) return;

        state.inFlight = true;
        setBusy(true);

        const demoAtStart = state.demo;
        let newReading = false;

        // One alert request per cycle, started in parallel with the readings.
        const alertsPromise = fetchAlerts();

        try {
            if (state.demo) {
                state.list = state.demoList.map(normalize);
                state.latest = state.list[0] || null;
            } else {
                const [latest, list] = await Promise.all([
                    getJSON(API.latest),
                    getJSON(API.list)
                ]);

                if (state.demo !== demoAtStart) return;

                const previousId = state.latest ? state.latest.id : null;

                state.latest = latest ? normalize(latest) : null;
                state.list = Array.isArray(list)
                    ? list.map(normalize)
                    : [];

                newReading =
                    previousId != null &&
                    state.latest != null &&
                    state.latest.id != null &&
                    String(previousId) !== String(state.latest.id);
            }

            state.loaded = true;
            state.failed = false;

            if ($('lastFetch')) {
                $('lastFetch').textContent =
                    new Date().toLocaleTimeString();
            }

            hideError();
        } catch (err) {
            state.failed = true;
            showError(
                `Could not load data: ${err.message}. Is Spring Boot running on this address?`
            );
        } finally {
            let alertsResult = await alertsPromise;

            // Demo mode was toggled while this request was in flight: discard and redo.
            if (state.demo !== demoAtStart) {
                state.inFlight = false;
                setBusy(false);
                refresh();
                return;
            }

            // A new reading arrived but no alert refers to it yet: confirm once,
            // in case the alert was saved just after our parallel request.
            if (
                newReading &&
                alertsResult.ok &&
                Array.isArray(alertsResult.data) &&
                !alertsResult.data.some(
                    (a) => a.readingId != null &&
                        String(a.readingId) === String(state.latest.id)
                )
            ) {
                alertsResult = await fetchAlerts();
            }

            applyAlerts(alertsResult);

            state.inFlight = false;
            setBusy(false);
            render();
        }
    }

    function startPolling() {
        stopPolling();
        state.timer = setInterval(refresh, REFRESH_MS);
    }

    function stopPolling() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }
    }

    function setDemo(on) {
        state.demo = on;
        state.latest = null;
        state.list = [];
        state.alerts = [];
        state.alertsFailed = false;
        state.alertsLoadedOnce = false;
        state.testSeen.clear();
        state.loaded = false;
        state.failed = false;

        if (on) {
            state.demoList = makeDemoData();
        }

        if ($('demoBanner')) $('demoBanner').hidden = !on;

        if ($('sourceChip')) {
            $('sourceChip').textContent = on
                ? 'Source: Simulated (demo)'
                : 'Source: Database readings';
        }

        hideError();
        render();
        refresh();
    }

    /* ================= Navigation ================= */
    function initNav() {
        const nav = $('nav');
        const links = $('navLinks');
        const btn = $('menuBtn');

        if (!nav || !links || !btn) return;

        const onScroll = () => {
            nav.classList.toggle('solid', window.scrollY > 20);
        };

        onScroll();

        window.addEventListener('scroll', onScroll, {
            passive: true
        });

        const setMenu = (open) => {
            links.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', String(open));
        };

        btn.addEventListener('click', () => {
            setMenu(!links.classList.contains('open'));
        });

        links.addEventListener('click', (event) => {
            if (event.target.closest('a')) {
                setMenu(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setMenu(false);
            }
        });
    }

    /* ================= Decorative motion (progressive enhancement) ================= */
    function initMotion() {
        const reduce = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;

        // Reveal once, only for blocks that start below the fold. Never re-run on refresh.
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) {
                        e.target.classList.add('in');
                        io.unobserve(e.target);
                    }
                });
            }, { threshold: 0.12 });

            document.querySelectorAll('.sec-head, .feat .card, .steps li, .about').forEach((node) => {
                if (node.getBoundingClientRect().top > window.innerHeight) {
                    node.classList.add('rv');
                    io.observe(node);
                }
            });
        }

        // Gentle pointer tilt on the hero illustration (fine pointers only).
        const viz = document.querySelector('.viz');
        if (viz && window.matchMedia('(pointer: fine)').matches) {
            let raf = 0;
            window.addEventListener('pointermove', (e) => {
                if (raf) return;
                raf = requestAnimationFrame(() => {
                    raf = 0;
                    const x = e.clientX / window.innerWidth - 0.5;
                    const y = e.clientY / window.innerHeight - 0.5;
                    viz.style.setProperty('--ry', (x * 10).toFixed(2) + 'deg');
                    viz.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
                });
            }, { passive: true });
        }
    }

    /* ================= Init ================= */
    function init() {
        initNav();
        initMotion();

        if ($('refreshBtn')) {
            $('refreshBtn').addEventListener('click', refresh);
        }

        if ($('retryBtn')) {
            $('retryBtn').addEventListener('click', refresh);
        }

        if ($('alertsRefreshBtn')) {
            $('alertsRefreshBtn').addEventListener('click', refreshAlerts);
        }

        if ($('dismissCurrentAlert')) {
            $('dismissCurrentAlert').addEventListener('click', dismissCurrentAlerts);
        }

        if ($('reopenAlertBtn')) {
            $('reopenAlertBtn').addEventListener('click', reopenCurrentAlerts);
        }

        // Keyboard: Esc acknowledges; Tab cycles between the scrolling
        // alert details and the acknowledge button while the screen is open.
        document.addEventListener('keydown', (event) => {
            if (!state.overlayOpen) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                dismissCurrentAlerts();
                return;
            }

            if (event.key === 'Tab') {
                const focusables = [$('currentAlertBody'), $('dismissCurrentAlert')]
                    .filter((node) => node && !node.disabled);

                event.preventDefault();

                if (focusables.length === 0) return;

                const i = focusables.indexOf(document.activeElement);
                const next = event.shiftKey
                    ? (i <= 0 ? focusables.length - 1 : i - 1)
                    : (i === -1 || i === focusables.length - 1 ? 0 : i + 1);

                focusables[next].focus();
            }
        });

        // Keep the "reading is N minutes old" text current without re-rendering.
        state.freshTimer = setInterval(updateFreshness, 15000);

        if ($('demoToggle')) {
            $('demoToggle').addEventListener('change', (event) => {
                setDemo(event.target.checked);
            });
        }

        window.addEventListener('pagehide', () => {
            stopPolling();
            if (state.freshTimer) clearInterval(state.freshTimer);
        });

        initCharts();
        render();
        refresh();
        startPolling();
    }

    init();
})();