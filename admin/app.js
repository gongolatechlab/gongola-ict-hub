alert('APP.JS STARTED');


/* =========================================================
   GONGOLA ICT HUB - ADMIN CORE LOGIC (CLEAN PHASE 1)
   ========================================================= */

const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXl5Y3F3Z2R5a2xmenJpbnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTg5NjYsImV4cCI6MjEwOTE5NDk2Nn0.jgEo3bvyKK_ak1yMRILX-32tCrg8BKSlzDvu-ccDq3w';

let supabase = null;
let currentUser = null;
let signalsData = [];

async function initializeApp() {
    console.log('[Gongola] Initializing...');
    
    // 1. Wait for Supabase CDN
    let attempts = 0;
    while (!window.supabase && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    
    if (!window.supabase) {
        alert('Supabase library failed to load. Please check your internet and refresh.');
        return;
    }

    // 2. Create Client
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Gongola] Client created');

    // 3. Attach Login Handler
    const loginBtn = document.getElementById('btn-login');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        alert('LOGIN ATTACHED');
    } else {
        alert('LOGIN BUTTON MISSING');
    }

    // 4. Setup Listeners
    setupNavigation();
    setupPostForm();

    // 5. Check Session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        showApp();
    } else {
        showLogin();
    }

    // 6. Listen for Auth Changes
    supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
        } else {
            currentUser = null;
            showLogin();
        }
    });
}

// Run initialization (handles both cases)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('btn-login');
    
    if (!email || !password) return alert('Please enter email and password');
    
    btn.innerText = 'Authenticating...';
    btn.disabled = true;
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        alert('Login Failed: ' + error.message);
        btn.innerText = 'Login';
        btn.disabled = false;
    }
    // On success, onAuthStateChange will trigger showApp()
}

async function handleLogout() {
    await supabase.auth.signOut();
}

function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-shell').style.display = 'block';
    fetchDashboardData();
}

function showLogin() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('app-shell').style.display = 'none';
}

// --- REST OF THE FILE (navigation, data, metrics) ---

// --- NAVIGATION ---
function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-item, .side-nav-item');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.dataset.target;
            if(!target) return;
            
            navBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`[data-target="${target}"]`).forEach(b => b.classList.add('active'));
            
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + target).classList.add('active');
        });
    });
}

// --- DATA FETCHING & METRICS ---
async function fetchDashboardData() {
    const { data, error } = await supabase.from('signals').select('*').order('created_at', { ascending: false });
    if (error) return console.error('Error fetching signals:', error);
    
    signalsData = data || [];
    calculateMetrics();
    renderSignals();
}

function calculateMetrics() {
    if (signalsData.length === 0) return;

    let totalPnl = 0;
    let wins = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let closedCount = 0;

    signalsData.forEach(sig => {
        // Map old 'result' or new 'status' to closed
        const isClosed = (sig.status && sig.status.startsWith('closed')) || sig.result === 'win' || sig.result === 'loss';
        
        if (isClosed) {
            closedCount++;
            let pnl = sig.pnl;
            
            // Fallback for old signals without pnl field
            if (pnl === null || pnl === undefined) {
                const entry = parseFloat(sig.entry), tp = parseFloat(sig.tp), sl = parseFloat(sig.sl);
                const risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
                if (sig.result === 'win' || sig.status === 'closed-tp') pnl = reward;
                else if (sig.result === 'loss' || sig.status === 'closed-sl') pnl = -risk;
                else pnl = 0;
            }

            totalPnl += pnl;
            if (pnl > 0) {
                wins++;
                grossWin += pnl;
            } else if (pnl < 0) {
                grossLoss += Math.abs(pnl);
            }
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
    const closed = signalsData.filter(s => (s.status && s.status.startsWith('closed')) || s.result === 'win' || s.result === 'loss').reverse();
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
    
    let svgPoints = "";
    let svgArea = `M 0 ${100 - ((0 - min) / range) * 100} `;

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

// --- RENDER SIGNALS LIST ---
function renderSignals() {
    const container = document.getElementById('signals-list');
    container.innerHTML = '';

    if (signalsData.length === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No signals found.</div>';
        return;
    }

    signalsData.forEach(sig => {
        let statusClass = 'chip-waiting';
        let displayStatus = 'WAITING';
        
        if (sig.status === 'open') { statusClass = 'chip-open'; displayStatus = 'OPEN'; }
        else if (sig.status === 'closed-tp') { statusClass = 'chip-closed-tp'; displayStatus = 'CLOSED (TP)'; }
        else if (sig.status === 'closed-sl') { statusClass = 'chip-closed-sl'; displayStatus = 'CLOSED (SL)'; }
        else if (sig.status === 'cancelled') { statusClass = 'chip-cancelled'; displayStatus = 'CANCELLED'; }

        const pnlDisplay = sig.pnl !== null ? (sig.pnl > 0 ? '+$' : '-$') + Math.abs(sig.pnl).toFixed(2) : '---';
        const pnlColor = sig.pnl > 0 ? 'text-green' : (sig.pnl < 0 ? 'text-red' : 'text-muted');

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
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
        `;
        container.appendChild(card);
    });
}

// --- POST SIGNAL LOGIC ---
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function setupPostForm() {
    const entryInput = document.getElementById('post-entry');
    const slInput = document.getElementById('post-sl');
    const tpInput = document.getElementById('post-tp');
    const dirInput = document.getElementById('post-direction');
    const rrPreview = document.getElementById('rr-preview');

    const calculateRR = () => {
        const entry = parseFloat(entryInput.value);
        const sl = parseFloat(slInput.value);
        const tp = parseFloat(tpInput.value);
        const dir = dirInput.value;
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

        const asset = document.getElementById('post-asset').value.toUpperCase();
        const direction = dirInput.value;
        const entry = parseFloat(entryInput.value);
        const sl = parseFloat(slInput.value);
        const tp = parseFloat(tpInput.value);
        const analysis = document.getElementById('post-analysis').value;
        const fileInput = document.getElementById('chart-upload');

        let imageUrl = null;

        try {
            // 1. Upload Chart if provided
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
                const { error: uploadError } = await supabase.storage.from('charts').upload(fileName, file);
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from('charts').getPublicUrl(fileName); 
                imageUrl = publicUrlData.publicUrl;
            }

            // 2. Insert Signal
            const { error } = await supabase.from('signals').insert([{
                asset, direction, entry, sl, tp, analysis, 
                image_url: imageUrl,
                status: 'waiting',
                result: 'pending' // Legacy compatibility
            }]);

            if (error) throw error;

            alert('Signal Published!');
            closeModal('post-signal-modal');
            e.target.reset();
            rrPreview.innerText = '--';
            fetchDashboardData();
        } catch (err) {
            alert('Failed: ' + err.message);
        } finally {
            btn.innerText = 'Publish Signal'; btn.disabled = false;
        }
    });
}
