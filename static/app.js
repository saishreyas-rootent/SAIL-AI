/**
 * MECON-AI Professional Web Interface
 * Fixed: initChart type variable, dark mode chart colors, all rendering bugs
 */

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentThreadId = null;
let currentCategory = "All Categories";
let isProcessing = false;
let abortController = null;
let chatHistory = JSON.parse(localStorage.getItem('mecon_history') || '[]');
let chartInstances = {};

// ─── UI ELEMENTS ─────────────────────────────────────────────────────────────
const chatMsgs = document.getElementById('chat-messages');
const userInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const emptyState = document.getElementById('empty-state');
const newChatBtn = document.getElementById('new-chat-btn');

renderHistory();

// ─── CATEGORY NAV ────────────────────────────────────────────────────────────
document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.getAttribute('data-category');
    });
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) {
    userInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    });
}

if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
        currentThreadId = null;
        Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) { } });
        chartInstances = {};
        localStorage.removeItem('mecon_history');
        window.location.reload();
    });
}

document.querySelectorAll('.suggestion').forEach(s => {
    s.addEventListener('click', () => {
        if (userInput) {
            userInput.value = s.querySelector('.sug-text') ? s.querySelector('.sug-text').textContent : s.textContent;
            sendMessage();
        }
    });
});

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function updateHistory(query) {
    chatHistory.unshift({ query: query.substring(0, 40), time: new Date().toLocaleTimeString() });
    if (chatHistory.length > 10) chatHistory.pop();
    localStorage.setItem('mecon_history', JSON.stringify(chatHistory));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (list) {
        list.innerHTML = chatHistory.slice(0, 6).map(h =>
            `<div class="history-item" title="${escapeHtml(h.query)}">${escapeHtml(h.query)}</div>`
        ).join('');
    }
}

// ─── CORE SEND ───────────────────────────────────────────────────────────────
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isProcessing) return;

    const es = document.getElementById('empty-state');
    if (es) es.remove();

    userInput.value = '';
    userInput.style.height = 'auto';
    isProcessing = true;
    abortController = new AbortController();
    toggleProcessingState(true);

    appendMessage('user', text);
    updateHistory(text);
    addTyping();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: text,
                category: currentCategory,
                thread_id: 'unused'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Server error');

        if (data.thread_id) currentThreadId = data.thread_id;

        removeTyping();
        handleApiResponse(data);

    } catch (error) {
        removeTyping();
        if (error.name === 'AbortError') {
            appendMessage('bot', '⚠ Request stopped.');
        } else {
            console.error(error);
            appendMessage('bot', `⚠ Error: ${error.message || 'Could not connect to MECON-AI server.'}`);
        }
    } finally {
        isProcessing = false;
        abortController = null;
        toggleProcessingState(false);
    }
}

function stopRequest() {
    if (abortController) abortController.abort();
}

function toggleProcessingState(busy) {
    if (sendBtn) {
        if (busy) {
            sendBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2"/></svg>`;
            sendBtn.style.background = 'var(--red)';
            sendBtn.onclick = stopRequest;
        } else {
            sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 12V2M2 7l5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            sendBtn.style.background = '';
            sendBtn.onclick = sendMessage;
        }
    }
}

// ─── RESPONSE HANDLER ────────────────────────────────────────────────────────
function handleApiResponse(data) {
    if (!data || !data.state) {
        appendMessage('bot', '⚠ Received malformed data from the server.');
        return;
    }

    const state = data.state;

    // 1. Final answer - render structured JSON *immediately* if it exists
    if (state.final_answer) {
        appendStructuredMessage(state.final_answer, state.sources, true);
        return;
    }

    // 2. Clarification needed — show sub-questions card, if needed
    if (data.awaiting_clarification && data.clarification_questions && data.clarification_questions.length) {
        const parsed = tryParseJson(state.current_draft);
        const intro = parsed ? (parsed.answer_text || '') : '';
        appendClarificationCard(intro, data.clarification_questions);
        return;
    }

    // 3. Expert HITL review needed
    if (data.is_waiting_for_review) {
        const parsed = tryParseJson(state.current_draft);
        const draft = parsed ? (parsed.answer_text || state.current_draft) : state.current_draft;
        appendReviewMessage(draft);
        return;
    }

    // 4. If we get here and there is a draft but no final answer, show the draft
    if (state.current_draft && !state.final_answer) {
        appendStructuredMessage(state.current_draft, state.sources, true);
        return;
    }

    // 5. If all else fails:
    appendMessage('bot', '⚠ No answer was generated. Please try again.');
}

// ─── CLARIFICATION CARD ──────────────────────────────────────────────────────
function appendClarificationCard(introText, questions) {
    const cardId = 'clarify_' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg bot';
    div.id = cardId;

    const questionFields = questions.map((q, i) => `
        <div class="clarify-question">
            <div class="clarify-q-label">${escapeHtml(q)}</div>
            <input
                type="text"
                class="clarify-input"
                id="${cardId}_q${i}"
                placeholder="Your answer…"
                onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); submitClarification('${cardId}', ${JSON.stringify(questions).replace(/"/g, '&quot;')}); }"
            />
        </div>
    `).join('');

    const introHtml = introText
        ? `<div class="clarify-intro">${renderMarkdown(introText)}</div>`
        : '';

    const questionsJson = JSON.stringify(questions);

    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-body" style="max-width:85%">
            <div class="msg-bubble clarify-bubble">
                ${introHtml}
                <div class="clarify-questions-wrap">${questionFields}</div>
                <div class="clarify-actions">
                    <button class="clarify-submit-btn" id="${cardId}_btn">↑ Send Answers</button>
                </div>
            </div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }

    // Attach events after DOM insertion (no inline onclick)
    document.getElementById(`${cardId}_btn`).addEventListener('click', () => {
        submitClarification(cardId, questions);
    });
    questions.forEach((_, i) => {
        const inp = document.getElementById(`${cardId}_q${i}`);
        if (inp) {
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitClarification(cardId, questions);
                }
            });
        }
    });

    setTimeout(() => {
        const first = document.getElementById(`${cardId}_q0`);
        if (first) first.focus();
    }, 100);
}

async function submitClarification(cardId, questions) {
    if (!currentThreadId) {
        appendMessage('bot', '⚠ Session expired — please send your question again.');
        return;
    }

    const answers = questions.map((_, i) => {
        const input = document.getElementById(`${cardId}_q${i}`);
        return input ? input.value.trim() : '';
    });

    if (answers.every(a => !a)) {
        const firstInput = document.getElementById(`${cardId}_q0`);
        if (firstInput) firstInput.focus();
        return;
    }

    const card = document.getElementById(cardId);
    if (card) {
        const bubble = card.querySelector('.clarify-bubble');
        if (bubble) {
            bubble.style.opacity = '0.5';
            bubble.style.pointerEvents = 'none';
            bubble.innerHTML = `<div class="clarify-submitted"><span class="clarify-submitted-icon">✓</span> Answers submitted — generating your response…</div>`;
        }
    }

    const feedbackText = questions.map((q, i) =>
        `Q: ${q}\nA: ${answers[i] || '(not provided)'}`
    ).join('\n\n');

    const answersDisplay = answers.filter(Boolean).join(' · ');
    appendMessage('user', answersDisplay);
    addTyping();
    toggleInput(false);

    try {
        const response = await fetch('/api/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'clarify',
                feedback: feedbackText,
                thread_id: currentThreadId
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Failed to submit answers');

        removeTyping();
        // Make sure handleApiResponse is correctly called after submitClarification
        handleApiResponse(data);

    } catch (error) {
        removeTyping();
        appendMessage('bot', `⚠ Error: ${error.message}`);
    } finally {
        toggleInput(true);
    }
}

// ─── STRUCTURED MESSAGE RENDERER ─────────────────────────────────────────────
function appendStructuredMessage(content, sources, animate = false) {
    const parsed = tryParseJson(content);

    if (!parsed) {
        appendMessage('bot', content, sources, animate);
        return;
    }

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const div = document.createElement('div');
    div.className = 'msg bot fade-in';

    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-body">
            <div class="msg-bubble" id="${msgId}-bubble"></div>
            <div id="${msgId}-extras" style="display:none"></div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }

    const bubble = document.getElementById(`${msgId}-bubble`);
    const extrasArea = document.getElementById(`${msgId}-extras`);

    if (parsed.is_datasheet) {
        renderDatasheet(bubble, extrasArea, parsed, msgId);
        return; // Stop here
    }

    // Existing rendering logic (price estimates, etc.)
    if (animate) {
        const sequence = [];
        if (parsed.summary) sequence.push({ type: 'summary', text: parsed.summary });
        if (parsed.answer_text) sequence.push({ type: 'answer', text: parsed.answer_text });

        runAnimationSequence(bubble, sequence, () => {
            renderExtras(extrasArea, parsed, sources, msgId);
            extrasArea.style.display = 'block';
            extrasArea.classList.add('fade-in');
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        });
    } else {
        renderFullStructured(bubble, extrasArea, parsed, sources, msgId);
        extrasArea.style.display = 'block';
    }
}

function renderDatasheet(bubbleElement, extrasElement, parsed, msgId) {
    let bubbleHtml = '';
    if (parsed.datasheet_summary) {
        bubbleHtml += `<div class="msg-summary">${escapeHtml(parsed.datasheet_summary)}</div>`;
    }
    if (parsed.answer_text) {
        bubbleHtml += `<div class="msg-answer-text">${renderMarkdown(parsed.answer_text)}</div>`;
    }
    bubbleElement.innerHTML = bubbleHtml;

    // ← FIX: show extrasElement before rendering tables into it
    extrasElement.style.display = 'block';
    renderExtras(extrasElement, parsed, [], msgId);
    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function renderFullStructured(bubbleElement, extrasElement, parsed, sources, msgId) {
    let bubbleHtml = '';
    if (parsed.summary) {
        bubbleHtml += `<div class="msg-summary">${escapeHtml(parsed.summary)}</div>`;
    }
    if (parsed.answer_text) {
        bubbleHtml += `<div class="msg-answer-text">${renderMarkdown(parsed.answer_text)}</div>`;
    }
    bubbleElement.innerHTML = bubbleHtml;
    renderExtras(extrasElement, parsed, sources, msgId);
}

function renderExtras(container, parsed, sources, msgId) {
    let html = '';

    if (parsed.tables && parsed.tables.length) {
        parsed.tables.forEach((tbl, ti) => {
            html += buildTableHtml(tbl, `${msgId}_tbl${ti}`);
        });
    }

    if (parsed.charts && parsed.charts.length) {
        parsed.charts.forEach((chart, ci) => {
            const canvasId = `${msgId}_chart${ci}`;
            html += `
                <div class="chart-container">
                    <div class="chart-title">${escapeHtml(chart.title || '')}</div>
                    <div class="chart-wrap">
                        <canvas id="${canvasId}"></canvas>
                    </div>
                </div>`;
        });
    }

    const srcArray = (parsed.sources && parsed.sources.length) ? parsed.sources : (sources || []);
    if (Array.isArray(srcArray) && srcArray.length) {
        const chips = srcArray.map(s =>
            `<span class="source-chip" title="${escapeHtml(s.source || s)}">
                ${escapeHtml((s.source || s).split('—')[0].trim())}
            </span>`
        ).join('');
        html += `<div class="msg-source" style="margin-top:8px;">Sources: ${chips}</div>`;
    }

    container.innerHTML = html;

    // Init charts AFTER html is in DOM
    if (parsed.charts && parsed.charts.length) {
        parsed.charts.forEach((chart, ci) => {
            initChart(`${msgId}_chart${ci}`, chart);
        });
    }
}

function runAnimationSequence(container, sequence, callback) {
    if (sequence.length === 0) {
        if (callback) callback();
        return;
    }

    const item = sequence.shift();
    const subDiv = document.createElement('div');
    if (item.type === 'summary') subDiv.className = 'msg-summary';
    else if (item.type === 'answer') subDiv.className = 'msg-answer-text';
    container.appendChild(subDiv);

    if (item.type === 'summary') {
        const fullTxt = item.text;
        typeEffect(subDiv, fullTxt, 15, () => {
            subDiv.innerHTML = escapeHtml(fullTxt);
            runAnimationSequence(container, sequence, callback);
        }, true);
    } else {
        typeEffect(subDiv, item.text, 12, () => {
            runAnimationSequence(container, sequence, callback);
        });
    }
}

function typeEffect(element, rawText, speed = 10, callback, plainText = false) {
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    element.appendChild(cursor);

    let tokens = [];
    if (rawText.length > 300) {
        // Half a sentence at a time
        const words = rawText.split(/ /);
        for (let j = 0; j < words.length; j += 6) {
            tokens.push(words.slice(j, j + 6).join(' ') + ' ');
        }
    } else if (rawText.length > 80) {
        // Word by word
        const words = rawText.split(/ /);
        for (let j = 0; j < words.length; j++) {
            tokens.push(words[j] + ' ');
        }
    } else {
        // Letter by letter
        tokens = rawText.split('');
    }

    let currentText = '';
    let i = 0;

    let currentSpeed = speed;
    if (rawText.length > 300) currentSpeed = 30; // Wait longer between big chunks
    else if (rawText.length > 80) currentSpeed = 15; // Moderate for words
    else currentSpeed = 5; // Very fast for letters

    const interval = setInterval(() => {
        if (i < tokens.length) {
            currentText += tokens[i];
            element.innerHTML = plainText ? escapeHtml(currentText) : renderMarkdown(currentText);
            element.appendChild(cursor);
            if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
            i++;
        } else {
            clearInterval(interval);
            cursor.remove();
            element.innerHTML = plainText ? escapeHtml(rawText) : renderMarkdown(rawText);
            if (callback) callback();
        }
    }, currentSpeed);
}

// ─── TABLE BUILDER ────────────────────────────────────────────────────────────
// ─── TABLE BUILDER ────────────────────────────────────────────────────────────
// ─── TABLE BUILDER ────────────────────────────────────────────────────────────
function buildTableHtml(tbl, id) {
    if (!tbl.headers || !tbl.rows) return '';

    const title = tbl.title || 'Table';
    const titleHtml = `<div class="tbl-title">${escapeHtml(title)}</div>`;

    const downloadBtn = `
        <button class="tbl-download-btn" title="Download as Excel" onclick="downloadTableAsXlsx('${id}', '${escapeHtml(title).replace(/'/g, "\\'")}')">
            ⬇ Download XLS
        </button>`;

    const ths = tbl.headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join('');
    const trs = tbl.rows.map((row) => {
        const isTotal = row[0] && String(row[0]).toLowerCase().includes('total');
        const rowClass = isTotal ? ' class="total-row"' : '';
        const tds = row.map(cell => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('');
        return `<tr${rowClass}>${tds}</tr>`;
    }).join('');

    return `
        <div class="tbl-container" id="${id}">
            <div class="tbl-header-row">
                ${titleHtml}
                ${downloadBtn}
            </div>
            <div class="tbl-scroll">
                <table class="spec-table" id="${id}_table">
                    <thead><tr>${ths}</tr></thead>
                    <tbody>${trs}</tbody>
                </table>
            </div>
        </div>`;
}

function downloadTableAsXlsx(tableId, title) {
    const table = document.getElementById(`${tableId}_table`);
    if (!table) return;

    const rows = [];

    // Header row
    const headers = Array.from(table.querySelectorAll('thead tr th')).map(th => th.innerText);
    rows.push(headers);

    // Data rows
    Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText);
        rows.push(cells);
    });

    // Build CSV content (XLS-compatible)
    const csvContent = rows.map(r =>
        r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Add BOM for Excel UTF-8 compatibility
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '_')}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

window.downloadTableAsXlsx = downloadTableAsXlsx;

// ─── CHART.JS INITIALIZER ─────────────────────────────────────────────────────
function initChart(canvasId, chartDef) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // ✅ FIX: extract type from chartDef FIRST before any usage
    const type = chartDef.type || 'bar';

    if (chartInstances[canvasId]) {
        try { chartInstances[canvasId].destroy(); } catch (e) { }
        delete chartInstances[canvasId];
    }

    // Resolve theme-aware colors from CSS variables
    const isDark = document.body.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#9ca3af' : '#6b7280';
    const tooltipBg = isDark ? '#1e2433' : '#ffffff';
    const tooltipBorder = isDark ? '#2d3548' : '#e5e7eb';
    const tooltipTitle = isDark ? '#f1f5f9' : '#0f1117';
    const tooltipBody = isDark ? '#94a3b8' : '#6b7280';

    const accentColors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
        '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'
    ];

    // ✅ FIX: type is now defined before this map runs
    const datasets = (chartDef.datasets || []).map((ds, i) => {
    // FIX: coerce all data values to numbers (LLM sometimes returns "65,000" strings)
    const cleanData = (ds.data || []).map(v =>
        typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : Number(v)
    );
    const color = ds.color || accentColors[i % accentColors.length];

    if (type === 'pie') {
        return {
            label: ds.label || '',
            data: cleanData,
            backgroundColor: cleanData.map((_, j) => accentColors[j % accentColors.length]),
            borderColor: '#161b22',
            borderWidth: 2,
            hoverOffset: 8
        };
    }
    if (type === 'radar') {
        return {
            label: ds.label || '',
            data: cleanData,
            backgroundColor: hexToRgba(color, 0.15),
            borderColor: color,
            borderWidth: 2,
            pointBackgroundColor: color,
            pointRadius: 4,
            pointHoverRadius: 6
        };
    }
    return {
        label: ds.label || '',
        data: cleanData,
        backgroundColor: type === 'bar' ? hexToRgba(color, 0.75) : hexToRgba(color, 0.12),
        borderColor: color,
        borderWidth: type === 'bar' ? 0 : 2,
        borderRadius: type === 'bar' ? 4 : 0,
        fill: type === 'line',
        tension: 0.35,
        pointBackgroundColor: color,
        pointRadius: type === 'line' ? 4 : 0,
        pointHoverRadius: 6,
        hoverBackgroundColor: type === 'bar' ? hexToRgba(color, 1) : undefined
    };
});

    const isPolar = type === 'pie' || type === 'radar';

    const config = {
        type,
        data: { labels: chartDef.labels || [], datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 900,
                easing: 'easeOutCubic',
                delay: (ctx) => {
                    if (ctx.type === 'data' && ctx.mode === 'default') {
                        return ctx.dataIndex * 40;
                    }
                    return 0;
                }
            },
            plugins: {
                legend: {
                    display: datasets.length > 1 || type === 'pie',
                    position: type === 'pie' ? 'right' : 'top',
                    labels: {
                        color: textColor,
                        font: { family: "'Geist Mono', monospace", size: 11 },
                        boxWidth: 12,
                        padding: 14,
                        usePointStyle: type !== 'pie'
                    }
                },
                tooltip: {
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    borderWidth: 1,
                    titleColor: tooltipTitle,
                    bodyColor: tooltipBody,
                    titleFont: { family: "'Geist', sans-serif", size: 12, weight: '600' },
                    bodyFont: { family: "'Geist Mono', monospace", size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
                            return `  ${ctx.dataset.label || ''}: ${val}`;
                        }
                    }
                }
            },
            scales: isPolar
                ? buildPolarScales(type, textColor, gridColor)
                : buildCartesianScales(textColor, gridColor, chartDef)
        }
    };

    chartInstances[canvasId] = new Chart(canvas, config);
}

function buildCartesianScales(textColor, gridColor, chartDef) {
    return {
        x: {
            grid: { color: gridColor, drawBorder: false },
            ticks: {
                color: textColor,
                font: { family: "'Geist Mono', monospace", size: 10 },
                maxRotation: 45,
                autoSkip: true,
                maxTicksLimit: 12
            },
            title: chartDef.xLabel
                ? { display: true, text: chartDef.xLabel, color: textColor, font: { family: "'Geist', sans-serif", size: 11 } }
                : { display: false }
        },
        y: {
            grid: { color: gridColor, drawBorder: false },
            ticks: {
                color: textColor,
                font: { family: "'Geist Mono', monospace", size: 10 }
            },
            title: chartDef.yLabel
                ? { display: true, text: chartDef.yLabel, color: textColor, font: { family: "'Geist', sans-serif", size: 11 } }
                : { display: false }
        }
    };
}

function buildPolarScales(type, textColor, gridColor) {
    if (type === 'radar') {
        return {
            r: {
                grid: { color: gridColor },
                angleLines: { color: gridColor },
                pointLabels: { color: textColor, font: { family: "'Geist Mono', monospace", size: 10 } },
                ticks: { color: textColor, backdropColor: 'transparent', font: { size: 9 } }
            }
        };
    }
    return {};
}

function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ─── EXPERT REVIEW CARD ───────────────────────────────────────────────────────
async function submitReview(action, feedback = null) {
    if (!currentThreadId) {
        appendMessage('bot', '⚠ Session lost — please send your message again.');
        return;
    }
    toggleInput(false);

    const lastReview = document.querySelector('.review-card');
    if (lastReview) {
        lastReview.style.opacity = '0.5';
        lastReview.style.pointerEvents = 'none';
        lastReview.innerHTML = action === 'approve'
            ? '<div class="review-header" style="color:var(--green)">✓ Approved — generating final answer…</div>'
            : '<div class="review-header">↻ Revision requested…</div>';
    }

    addTyping();

    try {
        const response = await fetch('/api/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action,
                feedback: feedback || null,
                thread_id: currentThreadId
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Review failed');
        removeTyping();
        handleApiResponse(data);
    } catch (error) {
        removeTyping();
        appendMessage('bot', `⚠ Error: ${error.message}`);
    } finally {
        toggleInput(true);
    }
}

function appendReviewMessage(draft) {
    const div = document.createElement('div');
    div.className = 'msg bot';
    const reviewId = 'review_' + Date.now();
    div.innerHTML = `
        <div class="msg-avatar">E1</div>
        <div class="msg-body">
            <div class="msg-bubble">${renderMarkdown(draft)}</div>
            <div class="review-card" id="${reviewId}">
                <div class="review-header">⚠ Expert Review Required</div>
                <textarea class="review-feedback-input" id="${reviewId}_txt"
                    placeholder="Add refinement instructions if needed…"></textarea>
                <div class="review-actions">
                    <button class="rev-btn refine" id="${reviewId}_refine">↻ Refine</button>
                    <button class="rev-btn approve" id="${reviewId}_approve">✓ Approve</button>
                </div>
            </div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }

    document.getElementById(`${reviewId}_approve`).addEventListener('click', () => {
        submitReview('approve');
    });
    document.getElementById(`${reviewId}_refine`).addEventListener('click', () => {
        const fb = document.getElementById(`${reviewId}_txt`).value;
        submitReview('refine', fb);
    });
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function toggleInput(enabled) {
    if (userInput) userInput.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
}

function addTyping() {
    removeTyping(); // prevent duplicates
    const div = document.createElement('div');
    div.className = 'msg bot';
    div.id = 'typing-indicator';
    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-body">
            <div class="msg-bubble">
                <div class="typing"><span></span><span></span><span></span></div>
            </div>
        </div>`;
    if (chatMsgs) { chatMsgs.appendChild(div); chatMsgs.scrollTop = chatMsgs.scrollHeight; }
}

function removeTyping() {
    const t = document.getElementById('typing-indicator');
    if (t) t.remove();
}

function appendMessage(role, content, sources, animate = false) {
    const div = document.createElement('div');
    div.className = `msg ${role} ${animate ? 'fade-in' : ''}`;
    const initials = role === 'user' ? 'YOU' : 'AI';

    div.innerHTML = `
        <div class="msg-avatar">${initials}</div>
        <div class="msg-body">
            <div class="msg-bubble"></div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }

    const bubble = div.querySelector('.msg-bubble');
    if (role === 'bot' && animate) {
        typeEffect(bubble, content, 20, () => {
            if (Array.isArray(sources) && sources.length) {
                appendSources(div.querySelector('.msg-body'), sources);
            }
        });
    } else {
        bubble.innerHTML = role === 'bot' ? renderMarkdown(content) : escapeHtml(content);
        if (role === 'bot' && Array.isArray(sources) && sources.length) {
            appendSources(div.querySelector('.msg-body'), sources);
        }
        if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
}

function appendSources(bodyEl, sources) {
    const chips = sources.map(s =>
        `<span class="source-chip" title="${escapeHtml(s.source || s)}">
            ${escapeHtml((s.source || s).split('—')[0].trim())}
        </span>`
    ).join('');
    const sc = document.createElement('div');
    sc.className = 'msg-source fade-in';
    sc.style.marginTop = '8px';
    sc.innerHTML = `Sources: ${chips}`;
    bodyEl.appendChild(sc);
    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function tryParseJson(text) {
    if (!text) return null;
    try {
        const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        return JSON.parse(clean);
    } catch (e) {
        return null;
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = String(text);

    // Tables
    html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (_, header, rows) => {
        const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
        const trs = rows.trim().split('\n').map(row => {
            const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table class="spec-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
    html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, m => `<ul>${m}</ul>`);
    html = html.replace(/\n/g, '<br/>');

    return html;
}

// Expose for any legacy references
window.submitReview = submitReview;
window.submitClarification = submitClarification;

// ─── THEME TOGGLE ────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('theme-toggle');
const moonIcon = document.getElementById('moon-icon');
const sunIcon = document.getElementById('sun-icon');

if (localStorage.getItem('mecon_theme') === 'dark') {
    document.body.classList.add('dark');
    if (moonIcon) moonIcon.style.display = 'none';
    if (sunIcon) sunIcon.style.display = 'block';
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark');
        localStorage.setItem('mecon_theme', isDark ? 'dark' : 'light');
        if (moonIcon && sunIcon) {
            moonIcon.style.display = isDark ? 'none' : 'block';
            sunIcon.style.display = isDark ? 'block' : 'none';
        }
    });
}