/* =========================================================
   GONGOLA ICT HUB - ADMIN CORE LOGIC (PHASE 2 FIXED)
   ========================================================= */

const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXl5Y3F3Z2R5a2xmenJpbnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTg5NjYsImV4cCI6MjEwOTE5NDk2Nn0.jgEo3bvyKK_ak1yMRILX-32tCrg8BKSlzDvu-ccDq3w';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfp3lOPcooUDUULMR6VOAy2_SNsWfzBWljHrKQ2Get8ddEfXByg62gwJlM9EreOTvVaQ/exec';

let sb = null;
let currentUser = null;
let signalsData = [];

// --- NAVIGATION (Global scope) ---
window.switchView = function(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item, .side-nav-item').forEach(b => {
        if(b.dataset.target === viewId) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    
    if (viewId === 'activity') fetchActivityLog();
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    let attempts = 0;
    while (!window.supabase && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    if (!window.supabase) return alert('Supabase CDN failed to load.');

    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Setup event listeners
    document.getElementById('btn-login')?.addEventListener('click', handleLogin);
    setupPostForm();
    setupImageUpload();

    // Check session
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        showApp();
    } else {
        showLogin();
    }

    sb.auth.onAuthStateChange((_event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
        } else {
            currentUser = null;
            showLogin();
        }
    });
});

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('btn-login');
    
    if (!email || !password) return alert('Please enter email and password');
    btn.innerText = 'Authenticating...';
    btn.disabled = true;
    
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        alert('Login Failed: ' + error.message);
        btn.innerText = 'Login';
        btn.disabled = false;
    }
}

async function handleLogout() {
    await sb.auth.signOut();
}

function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-shell').style.display = 'block';
    fetchDashboardData();
    syncBrokerData();
}

function showLogin() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('app-shell').style.display = 'none';
}

// --- DATA FETCHING & METRICS ---
async function fetchDashboardData() {
    const { data, error } = await sb.from('signals').select('*').order('created_at', { ascending: false });
    if (error) return console.error('Error fetching signals:', error);
    
    signalsData = data || [];
    calculateMetrics();
    renderSignals();
}

function calculateMetrics() {
    if (signalsData.length === 0) return;

    let totalPnl = 0, wins = 0, grossWin = 0, grossLoss = 0, closedCount = 0;

    signalsData.forEach(sig => {
        // Use the new 'status' column
        if (sig.status === 'closed-tp' || sig.status === 'closed-sl' || sig.result === 'win' || sig.result === 'loss') {
            closedCount++;
            let pnl = sig.pnl;
            
            // If pnl is missing, calculate from TP/SL
            if (pnl === null || pnl === undefined) {
                const entry = parseFloat(sig.entry), tp = parseFloat(sig.tp), sl = parseFloat(sig.sl);
                const risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
                pnl = (sig.result === 'win' || sig.status === 'closed-tp') ? reward : -risk;
            }

            totalPnl += pnl;
            if (pnl > 0) { wins++; grossWin += pnl; } 
            else if (pnl < 0) { grossLoss += Math.abs(pnl); }
        }
    });

    const winRate = closedCount > 0 ? Math.round((wins / closedCount) * 100) : 0;
    const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(1) : (grossWin > 0 ? '∞' : '0.0');

    document.getElementById('stat-pnl').innerText = (totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2);
    document.getElementById('stat-pnl').className = `metric-value ${totalPnl >= 0 ? 'text-green' : 'text-red'}`;
    document.getElementById('stat-winrate').innerText = winRate + '%';
    document.getElementById('stat-pf').innerText = pf;

    renderEquityCurve();
}

function renderEquityCurve() {
    const closed = signalsData.filter(s => s.status === 'closed-tp' || s.status === 'closed-sl' || s.result === 'win' || s.result === 'loss').reverse();
    if (closed.length < 2) return;

    let cumulative = 0;
    let points = [0];
    
    closed.forEach(s => {
        let pnl = s.pnl;
        if (pnl === null || pnl === undefined) {
            const entry = parseFloat(s.entry), tp = parseFloat(s.tp), sl = parseFloat(s.sl);
            pnl = (s.result === 'win' || s.status === 'closed-tp') ? Math.abs(tp - entry) : -Math.abs(entry - sl);
        }
        cumulative += pnl;
        points.push(cumulative);
    });

    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = Math.max(max - min, 1);
    
    let svgPoints = "", svgArea = `M 0 ${100 - ((0 - min) / range) * 100} `;

    points.forEach((val, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 100 - ((val - min) / range) * 100;
        svgPoints += `${x},${y} `;
        svgArea += `L ${x} ${y} `;
    });
    
    svgArea += `L 100 100 L 0 100 Z`;
    document.getElementById('equity-line').setAttribute('points', svgPoints);
    document.getElementById('equity-area').setAttribute('d', svgArea);
}

// --- SYNC BROKER DATA ---
async function syncBrokerData() {
    try {
        const res = await fetch(APPS_SCRIPT_URL, { 
            method: 'POST', headers: { 'Content-Type': 'text/plain' }, 
            body: JSON.stringify({ action: 'get_account' }) 
        });
        const data = await res.json();
        if (data.accounts && data.accounts.length > 0) {
            const bal = data.accounts[0].balance.balance;
            document.getElementById('stat-balance').innerText = '$' + parseFloat(bal).toFixed(2);
        }
    } catch(e) { console.warn('Broker sync failed', e); }
}

// --- RENDER SIGNALS LIST ---
function renderSignals() {
    const container = document.getElementById('signals-list');
    container.innerHTML = '';

    if (signalsData.length === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No signals found.</div>';
        return;
    }

    signalsData.forEach(sig => {
        let statusClass = 'chip-waiting', displayStatus = 'WAITING';
        if (sig.status === 'open') { statusClass = 'chip-open'; displayStatus = 'OPEN'; }
        else if (sig.status === 'closed-tp') { statusClass = 'chip-closed-tp'; displayStatus = 'CLOSED (TP)'; }
        else if (sig.status === 'closed-sl') { statusClass = 'chip-closed-sl'; displayStatus = 'CLOSED (SL)'; }

        const pnlDisplay = sig.pnl !== null ? (sig.pnl > 0 ? '+$' : '-$') + Math.abs(sig.pnl).toFixed(2) : '---';
        const pnlColor = sig.pnl > 0 ? 'text-green' : (sig.pnl < 0 ? 'text-red' : 'text-muted');

        container.innerHTML += `
            <div class="card">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                    <div>
                        <span class="font-bold text-lg">${sig.asset}</span>
                        <span class="chip ${sig.direction === 'BUY' ? 'chip-open' : 'chip-closed-sl'}" style="margin-left: 8px;">${sig.direction}</span>
                    </div>
                    <span class="chip ${statusClass}">${displayStatus}</span>
                </div>
                <div class="form-grid-2" style="font-size: 12px; margin-bottom: 12px;">
                    <div><span class="text-muted">Entry:</span> <span class="mono">${sig.entry}</span></div>
                    <div><span class="text-muted">Exit:</span> <span class="mono">${sig.exit_price || '---'}</span></div>
                    <div><span class="text-muted">SL:</span> <span class="mono text-red">${sig.sl}</span></div>
                    <div><span class="text-muted">TP:</span> <span class="mono text-green">${sig.tp}</span></div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 12px;">
                    <span class="text-xs text-muted">${new Date(sig.created_at).toLocaleDateString()}</span>
                    <span class="mono font-bold ${pnlColor}">${pnlDisplay}</span>
                </div>
            </div>
        `;
    });
}

// --- ACTIVITY LOG ---
async function fetchActivityLog() {
    const container = document.getElementById('activity-list');
    if (!container) return;
    
    const { data, error } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(20);
    if (error || !data || data.length === 0) {
        container.innerHTML = '<p class="text-muted text-sm text-center">No activity yet.</p>';
        return;
    }

    container.innerHTML = data.map(log => `
        <div class="card" style="padding: 12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span class="text-gold font-bold text-sm">${log.action}</span>
                <span class="text-xs text-muted">${new Date(log.created_at).toLocaleString()}</span>
            </div>
            <div class="text-xs text-muted font-mono">${JSON.stringify(log.details)}</div>
        </div>
    `).join('');
}

async function logActivity(action, details = {}) {
    if (!currentUser) return;
    try {
        await sb.from('audit_log').insert([{ user_id: currentUser.id, action, details }]);
    } catch(e) { console.error('Audit log failed', e); }
}

// --- AI CHART READING ---
function setupImageUpload() {
    const fileInput = document.getElementById('chart-upload');
    const statusEl = document.getElementById('ai-status');
    
    if (!fileInput || !statusEl) return;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        statusEl.style.display = 'block';
        statusEl.innerText = '🤖 AI is analyzing the chart... (this takes 10-20 seconds)';
        statusEl.style.color = 'var(--gold)';
        statusEl.style.background = 'rgba(245, 158, 11, 0.1)';
        statusEl.style.border = '1px solid var(--gold)';
        statusEl.style.padding = '10px';
        statusEl.style.borderRadius = '8px';

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = async function() {
                const canvas = document.createElement('canvas'); 
                canvas.width = 800; 
                canvas.height = img.height * (800 / img.width);
                const ctx = canvas.getContext('2d'); 
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const base64Data = canvas.toDataURL('image/jpeg', 0.7);
                
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
                    
                    const res = await fetch(APPS_SCRIPT_URL, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'text/plain' }, 
                        body: JSON.stringify({ action: 'analyze_chart', image: base64Data }),
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    
                    const text = await res.text(); 
                    let data; 
                    try { data = JSON.parse(text); } catch { throw new Error("Invalid server response."); }
                    
                    if(data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
                    
                    if (data.asset) document.getElementById('post-asset').value = data.asset.toUpperCase();
                    if (data.category) document.getElementById('post-category').value = data.category.charAt(0).toUpperCase() + data.category.slice(1).toLowerCase();
                    if (data.direction) document.getElementById('post-direction').value = data.direction.toUpperCase();
                    if (data.entry) document.getElementById('post-entry').value = data.entry;
                    if (data.sl) document.getElementById('post-sl').value = data.sl;
                    if (data.tp) document.getElementById('post-tp').value = data.tp;
                    if (data.analysis) document.getElementById('post-analysis').value = data.analysis.replace(/\*/g, '');
                    
                    statusEl.innerText = '✅ AI complete. Review fields below.';
                    statusEl.style.color = 'var(--green)';
                    statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
                    statusEl.style.border = '1px solid var(--green)';
                    document.getElementById('post-entry').dispatchEvent(new Event('input'));
                    
                } catch (err) {
                    statusEl.innerText = '❌ AI Error: ' + err.message + ' — Enter data manually.';
                    statusEl.style.color = 'var(--red)';
                    statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
                    statusEl.style.border = '1px solid var(--red)';
                    console.error('AI Error:', err);
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// --- POST FORM ---
function setupPostForm() {
    const entryInput = document.getElementById('post-entry');
    const slInput = document.getElementById('post-sl');
    const tpInput = document.getElementById('post-tp');
    const dirInput = document.getElementById('post-direction');
    const rrPreview = document.getElementById('rr-preview');

    const calculateRR = () => {
        const entry = parseFloat(entryInput.value), sl = parseFloat(slInput.value), tp = parseFloat(tpInput.value), dir = dirInput.value;
        if (isNaN(entry) || isNaN(sl) || isNaN(tp)) { rrPreview.innerText = '--'; return; }
        let risk = dir === 'BUY' ? entry - sl : sl - entry;
        let reward = dir === 'BUY' ? tp - entry : entry - tp;
        if (risk > 0 && reward > 0) {
            rrPreview.innerText = '1 : ' + (reward / risk).toFixed(2);
            rrPreview.style.color = 'var(--green)';
        } else {
            rrPreview.innerText = 'Invalid SL/TP';
            rrPreview.style.color = 'var(--red)';
        }
    };

    entryInput.addEventListener('input', calculateRR);
    slInput.addEventListener('input', calculateRR);
    tpInput.addEventListener('input', calculateRR);
    dirInput.addEventListener('change', calculateRR);

    document.getElementById('post-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.innerText = 'Publishing...'; btn.disabled = true;

        const asset = document.getElementById('post-asset').value.trim().toUpperCase();
        const category = document.getElementById('post-category').value;
        const direction = dirInput.value;
        const entry = parseFloat(entryInput.value);
        const sl = parseFloat(slInput.value);
        const tp = parseFloat(tpInput.value);
        const analysis = document.getElementById('post-analysis').value;
        const fileInput = document.getElementById('chart-upload');

        // VALIDATION - catch empty fields before hitting the database
        const missing = [];
        if (!asset) missing.push('Asset');
        if (isNaN(entry)) missing.push('Entry');
        if (isNaN(sl)) missing.push('SL');
        if (isNaN(tp)) missing.push('TP');

        if (missing.length > 0) {
            alert('Please fill in: ' + missing.join(', ') + '\n\nTip: Upload a chart and let the AI fill these automatically.');
            btn.innerText = 'Publish Signal'; btn.disabled = false;
            return;
        }

        let imageUrl = null;

        try {
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
                const { error: uploadError } = await sb.storage.from('charts').upload(fileName, file);
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = sb.storage.from('charts').getPublicUrl(fileName); 
                imageUrl = publicUrlData.publicUrl;
            }

            const { error } = await sb.from('signals').insert([{
                asset, category, direction, entry, sl, tp, analysis, 
                image_url: imageUrl, status: 'waiting', result: 'pending'
            }]);

            if (error) throw error;

            alert('Signal Published!');
            logActivity('SIGNAL_PUBLISHED', { asset, direction, entry });
            closeModal('post-signal-modal');
            e.target.reset();
            rrPreview.innerText = '--';
            document.getElementById('ai-status').style.display = 'none';
            fetchDashboardData();
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            btn.innerText = 'Publish Signal'; btn.disabled = false;
        }
    });
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
