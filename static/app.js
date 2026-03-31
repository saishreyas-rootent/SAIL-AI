/**
 * MECON-AI Professional Web Interface
 * Updated: clarification sub-questions, structured JSON rendering, Chart.js charts
 */

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentThreadId = null;
let currentCategory = "All Categories";
let isProcessing = false;
let abortController = null;
let chatHistory = JSON.parse(localStorage.getItem('mecon_history') || '[]');
let chartInstances = {};

// ─── UI ELEMENTS ─────────────────────────────────────────────────────────────
const chatMsgs      = document.getElementById('chat-messages');
const userInput     = document.getElementById('chat-input');
const sendBtn       = document.getElementById('send-btn');
const threadDisplay = document.getElementById('thread-display');
const emptyState    = document.getElementById('empty-state');
const sourcesView   = document.getElementById('panel-sources');
const traceView     = document.getElementById('panel-trace');

if (threadDisplay) threadDisplay.textContent = 'Thread: ready';
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

const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
        currentThreadId = null;
        Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
        chartInstances = {};
        localStorage.removeItem('mecon_history');
        window.location.reload();
    });
}

document.querySelectorAll('.suggestion').forEach(s => {
    s.addEventListener('click', () => {
        if (userInput) userInput.value = s.textContent;
        sendMessage();
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
            `<div class="history-item" title="${escapeHtml(h.query)}">${escapeHtml(h.query)}…</div>`
        ).join('');
    }
}

// ─── CORE SEND ───────────────────────────────────────────────────────────────
async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isProcessing) return;

    if (emptyState) emptyState.remove();
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

        if (data.thread_id) {
            currentThreadId = data.thread_id;
            if (threadDisplay) threadDisplay.textContent = `Thread: ${data.thread_id.substring(3, 11)}`;
        }

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
    toggleInput(!busy);
    if (sendBtn) {
        if (busy) {
            sendBtn.innerHTML = '■';
            sendBtn.style.background = 'var(--red, #e53935)';
            sendBtn.onclick = stopRequest;
        } else {
            sendBtn.innerHTML = '↑';
            sendBtn.style.background = 'var(--accent)';
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

    // 1. Clarification needed — show sub-questions card
    if (data.awaiting_clarification && data.clarification_questions && data.clarification_questions.length) {
        const parsed = tryParseJson(state.current_draft);
        const intro = parsed ? (parsed.answer_text || '') : '';
        appendClarificationCard(intro, data.clarification_questions);
        return;
    }

    // 2. Expert HITL review needed
    if (data.is_waiting_for_review) {
        const parsed = tryParseJson(state.current_draft);
        const draft = parsed ? (parsed.answer_text || state.current_draft) : state.current_draft;
        appendReviewMessage(draft);
        return;
    }

    // 3. Final answer — render structured JSON
    if (state.final_answer) {
        appendStructuredMessage(state.final_answer, state.sources, true);
    } else if (state.current_draft) {
        appendStructuredMessage(state.current_draft, state.sources, true);
    } else {
        appendMessage('bot', '⚠ No answer was generated. Please try again.');
    }
}

// ─── CLARIFICATION CARD ───────────────────────────────────────────────────────
/**
 * Renders a friendly card with up to 3 input fields for sub-questions.
 * On submit, packages answers and sends via /api/review with action="clarify".
 */
function appendClarificationCard(introText, questions) {
    const cardId = 'clarify_' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg bot';
    div.id = cardId;

    // Build input fields for each question
    const questionFields = questions.map((q, i) => `
        <div class="clarify-question">
            <div class="clarify-q-label">${escapeHtml(q)}</div>
            <input
                type="text"
                class="clarify-input"
                id="${cardId}_q${i}"
                placeholder="Your answer…"
                onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); submitClarification('${cardId}', ${JSON.stringify(questions).replace(/'/g, "\\'")}); }"
            />
        </div>
    `).join('');

    const introHtml = introText
        ? `<div class="clarify-intro">${renderMarkdown(introText)}</div>`
        : '';

    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-body" style="max-width:85%">
            <div class="msg-bubble clarify-bubble">
                ${introHtml}
                <div class="clarify-questions-wrap">
                    ${questionFields}
                </div>
                <div class="clarify-actions">
                    <button class="clarify-submit-btn" onclick="submitClarification('${cardId}', ${JSON.stringify(questions).replace(/'/g, "\\'")})">
                        ↑ Send Answers
                    </button>
                </div>
            </div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
        // Focus first input
        setTimeout(() => {
            const first = document.getElementById(`${cardId}_q0`);
            if (first) first.focus();
        }, 100);
    }
}

async function submitClarification(cardId, questions) {
    if (!currentThreadId) {
        appendMessage('bot', '⚠ Session expired — please send your question again.');
        return;
    }

    // Collect answers from all input fields
    const answers = questions.map((q, i) => {
        const input = document.getElementById(`${cardId}_q${i}`);
        return input ? input.value.trim() : '';
    });

    // Check at least one answer is given
    if (answers.every(a => !a)) {
        const firstInput = document.getElementById(`${cardId}_q0`);
        if (firstInput) firstInput.focus();
        return;
    }

    // Disable the card
    const card = document.getElementById(cardId);
    if (card) {
        const bubble = card.querySelector('.clarify-bubble');
        if (bubble) {
            bubble.style.opacity = '0.5';
            bubble.style.pointerEvents = 'none';
            // Show submitted answers summary
            const summary = questions.map((q, i) =>
                answers[i] ? `**${q}**\n${answers[i]}` : null
            ).filter(Boolean).join('\n\n');
            bubble.innerHTML = `<div class="clarify-submitted">
                <span class="clarify-submitted-icon">✓</span>
                Answers submitted — generating your response…
            </div>`;
        }
    }

    // Build feedback string combining Q+A pairs
    const feedbackText = questions.map((q, i) =>
        `Q: ${q}\nA: ${answers[i] || '(not provided)'}`
    ).join('\n\n');

    // Show user's answers as a message
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
            <div id="${msgId}-extras" style="display: ${animate ? 'none' : 'block'}"></div>
        </div>`;

    if (chatMsgs) {
        chatMsgs.appendChild(div);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }

    const bubble = document.getElementById(`${msgId}-bubble`);
    const extrasArea = document.getElementById(`${msgId}-extras`);

    if (animate) {
        const sequence = [];
        if (parsed.summary) {
            sequence.push({ type: 'summary', text: parsed.summary });
        }
        if (parsed.answer_text) {
            sequence.push({ type: 'answer', text: parsed.answer_text });
        }

        runAnimationSequence(bubble, sequence, () => {
            renderExtras(extrasArea, parsed, sources, msgId);
            extrasArea.style.display = 'block';
            extrasArea.classList.add('fade-in');
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        });
    } else {
        renderFullStructured(bubble, extrasArea, parsed, sources, msgId);
    }
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
    // Tables
    if (parsed.tables && parsed.tables.length) {
        parsed.tables.forEach((tbl, ti) => {
            html += buildTableHtml(tbl, `${msgId}_tbl${ti}`);
        });
    }
    // Charts
    if (parsed.charts && parsed.charts.length) {
        parsed.charts.forEach((chart, ci) => {
            const canvasId = `${msgId}_chart${ci}`;
            html += `
                <div class="chart-container">
                    <div class="chart-title">${escapeHtml(chart.title || '')}</div>
                    <div class="chart-wrap">
                        <canvas id="${canvasId}" height="220"></canvas>
                    </div>
                </div>`;
        });
    }
    // Sources
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

    // Init charts
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
            // Summary doesn't need markdown render usually but we can use escapeHtml then wrap
            subDiv.innerHTML = escapeHtml(fullTxt);
            runAnimationSequence(container, sequence, callback);
        }, true); // true for summary mode (no markdown)
    } else {
        typeEffect(subDiv, item.text, 12, () => {
            runAnimationSequence(container, sequence, callback);
        });
    }
}

function typeEffect(element, rawText, speed = 10, callback, plainText = false) {
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    element.appendChild(cursor);

    const interval = setInterval(() => {
        if (i < rawText.length) {
            i++;
            const currentText = rawText.substring(0, i);
            element.innerHTML = plainText ? escapeHtml(currentText) : renderMarkdown(currentText);
            element.appendChild(cursor);
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        } else {
            clearInterval(interval);
            cursor.remove();
            if (callback) callback();
        }
    }, speed);
}

// ─── TABLE BUILDER ────────────────────────────────────────────────────────────
function buildTableHtml(tbl, id) {
    if (!tbl.headers || !tbl.rows) return '';
    const title = tbl.title
        ? `<div class="tbl-title">${escapeHtml(tbl.title)}</div>` : '';
    const ths = tbl.headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join('');
    const trs = tbl.rows.map((row, ri) => {
        // Highlight total rows
        const isTotal = row[0] && String(row[0]).toLowerCase().includes('total');
        const rowClass = isTotal ? ' class="total-row"' : '';
        const tds = row.map(cell => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('');
        return `<tr${rowClass}>${tds}</tr>`;
    }).join('');
    return `
        <div class="tbl-container" id="${id}">
            ${title}
            <div class="tbl-scroll">
                <table class="spec-table">
                    <thead><tr>${ths}</tr></thead>
                    <tbody>${trs}</tbody>
                </table>
            </div>
        </div>`;
}

// ─── CHART.JS INITIALIZER ─────────────────────────────────────────────────────
function initChart(canvasId, chartDef) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartInstances[canvasId]) {
        try { chartInstances[canvasId].destroy(); } catch(e) {}
    }

    const type = chartDef.type || 'bar';
    const gridColor = 'rgba(48,54,61,0.8)';
    const textColor = '#8b949e';
    const accentColors = [
        '#e8a84c', '#58a6ff', '#3fb950', '#f85149',
        '#bc8cff', '#39d353', '#ffa657', '#79c0ff'
    ];

    const datasets = (chartDef.datasets || []).map((ds, i) => {
        const color = ds.color || accentColors[i % accentColors.length];

        if (type === 'pie') {
            return {
                label: ds.label || '',
                data: ds.data || [],
                backgroundColor: (ds.data || []).map((_, j) => accentColors[j % accentColors.length]),
                borderColor: '#161b22',
                borderWidth: 2,
                hoverOffset: 8
            };
        }
        if (type === 'radar') {
            return {
                label: ds.label || '',
                data: ds.data || [],
                backgroundColor: hexToRgba(color, 0.15),
                borderColor: color,
                borderWidth: 2,
                pointBackgroundColor: color,
                pointRadius: 4,
                pointHoverRadius: 6
            };
        }
        // bar / line
        return {
            label: ds.label || '',
            data: ds.data || [],
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
            maintainAspectRatio: true,
            animation: { duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    display: datasets.length > 1 || type === 'pie',
                    position: type === 'pie' ? 'right' : 'top',
                    labels: {
                        color: textColor,
                        font: { family: "'DM Mono', monospace", size: 10 },
                        boxWidth: 12,
                        padding: 12
                    }
                },
                tooltip: {
                    backgroundColor: '#1c2330',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    titleColor: '#e6edf3',
                    bodyColor: '#8b949e',
                    titleFont: { family: "'Sora', sans-serif", size: 12 },
                    bodyFont: { family: "'DM Mono', monospace", size: 11 },
                    padding: 10,
                    cornerRadius: 6,
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
                            return ` ${ctx.dataset.label || ''}: ${val}`;
                        }
                    }
                }
            },
            scales: isPolar ? buildPolarScales(type, textColor, gridColor)
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
                font: { family: "'DM Mono', monospace", size: 10 },
                maxRotation: 45, autoSkip: true, maxTicksLimit: 12
            },
            title: chartDef.xLabel
                ? { display: true, text: chartDef.xLabel, color: textColor, font: { family: "'Sora', sans-serif", size: 11 } }
                : { display: false }
        },
        y: {
            grid: { color: gridColor, drawBorder: false },
            ticks: { color: textColor, font: { family: "'DM Mono', monospace", size: 10 } },
            title: chartDef.yLabel
                ? { display: true, text: chartDef.yLabel, color: textColor, font: { family: "'Sora', sans-serif", size: 11 } }
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
                pointLabels: { color: textColor, font: { family: "'DM Mono', monospace", size: 10 } },
                ticks: { color: textColor, backdropColor: 'transparent', font: { size: 9 } }
            }
        };
    }
    return {};
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ─── EXPERT REVIEW CARD (for rare needs_review=true cases) ───────────────────
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
            : '<div class="review-header" style="color:var(--accent)">↻ Revision requested…</div>';
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
    div.innerHTML = `
        <div class="msg-avatar">E1</div>
        <div class="msg-body">
            <div class="msg-bubble">${renderMarkdown(draft)}</div>
            <div class="review-card">
                <div class="review-header">⚠ Expert Review Required</div>
                <textarea class="review-feedback-input" id="feedback-txt"
                    placeholder="Add refinement instructions if needed…"></textarea>
                <div class="review-actions">
                    <button class="rev-btn refine"
                        onclick="submitReview('refine', document.getElementById('feedback-txt').value)">
                        ↻ Refine
                    </button>
                    <button class="rev-btn approve" onclick="submitReview('approve')">
                        ✓ Approve
                    </button>
                </div>
            </div>
        </div>`;
    if (chatMsgs) { chatMsgs.appendChild(div); chatMsgs.scrollTop = chatMsgs.scrollHeight; }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function toggleInput(enabled) {
    if (userInput) userInput.disabled = !enabled;
    if (sendBtn)   sendBtn.disabled   = !enabled;
}

function addTyping() {
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
            // Render sources after typing is done
            if (Array.isArray(sources) && sources.length) {
                const chips = sources.map(s =>
                    `<span class="source-chip" title="${escapeHtml(s.source || s)}">
                        ${escapeHtml((s.source || s).split('—')[0].trim())}
                    </span>`
                ).join('');
                const sourceContainer = document.createElement('div');
                sourceContainer.className = 'msg-source fade-in';
                sourceContainer.style.marginTop = '8px';
                sourceContainer.innerHTML = `Sources: ${chips}`;
                div.querySelector('.msg-body').appendChild(sourceContainer);
                chatMsgs.scrollTop = chatMsgs.scrollHeight;
            }
        });
    } else {
        bubble.innerHTML = role === 'bot' ? renderMarkdown(content) : escapeHtml(content);
        if (role === 'bot' && Array.isArray(sources) && sources.length) {
            const chips = sources.map(s =>
                `<span class="source-chip" title="${escapeHtml(s.source || s)}">
                    ${escapeHtml((s.source || s).split('—')[0].trim())}
                </span>`
            ).join('');
            const sourceContainer = document.createElement('div');
            sourceContainer.className = 'msg-source';
            sourceContainer.style.marginTop = '8px';
            sourceContainer.innerHTML = `Sources: ${chips}`;
            div.querySelector('.msg-body').appendChild(sourceContainer);
        }
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
    }
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
    html = html.replace(/^### (.+)$/gm, '<strong style="color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.05em">$1</strong>');
    html = html.replace(/^## (.+)$/gm,  '<strong style="color:var(--text);font-size:13px">$1</strong>');
    html = html.replace(/^# (.+)$/gm,   '<strong style="color:var(--text);font-size:14px">$1</strong>');
    html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul style="margin:4px 0 4px 16px;padding:0">$1</ul>');
    html = html.replace(/\n/g, '<br/>');

    return html;
}

// Expose for inline onclick handlers
window.submitReview = submitReview;
window.submitClarification = submitClarification;