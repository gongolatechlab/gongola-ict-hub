const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXl5Y3F3Z2R5a2xmenJpbnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTg5NjYsImV4cCI6MjEwOTE5NDk2Nn0.jgEo3bvyKK_ak1yMRILX-32tCrg8BKSlzDvu-ccDq3w';
const AI_ENDPOINT = "https://script.google.com/macros/s/AKfycbzHs084KZZWsJMCuOAwz6JbLG7ZsvLCmL06iM4qKn9lLUdsOH1vvY5xKB_XHi8y28ibdQ/exec";
const EXECUTE_ENDPOINT = "https://script.google.com/macros/s/AKfycbzHs084KZZWsJMCuOAwz6JbLG7ZsvLCmL06iM4qKn9lLUdsOH1vvY5xKB_XHi8y28ibdQ/exec";

let supabaseClient = null;
let signalsData = [];
let liveTrades = [];
let currentSigDir = 'BUY';
let syncInterval = null;

// --- CUSTOM ALERT MODAL ---
window.alert = function(message) {
  let modal = document.getElementById('custom-alert-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'custom-alert-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `
    <div style="background:var(--card); border:1px solid var(--line); border-radius:20px; padding:24px; width:100%; max-width:340px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
      <div style="width:48px; height:48px; border-radius:50%; background:rgba(34,211,238,0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
      </div>
      <p style="color:#fff; font-size:15px; line-height:1.5; margin-bottom:20px;">${message}</p>
      <button onclick="document.getElementById('custom-alert-modal').remove()" style="width:100%; padding:12px; background:var(--cyan); color:#000; font-weight:bold; font-size:15px; border:none; border-radius:12px; cursor:pointer;">Got it</button>
    </div>
  `;
};

let accountBalance = 0;

// --- UNIVERSAL ERROR MODAL ---
function showUniversalError(msg) {
  let modal = document.getElementById('universal-error-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'universal-error-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:99999;display:flex;flex-direction:column;padding:20px;font-family:monospace;color:#fff;';
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding-bottom:10px;margin-bottom:10px;">
        <h2 style="color:#ff4444;margin:0;font-size:18px;">⚠️ SYSTEM ERROR</h2>
        <button onclick="document.getElementById('universal-error-modal').remove()" style="background:#333;color:#fff;border:none;padding:5px 15px;border-radius:5px;font-size:16px;">✕ Close</button>
      </div>
      <pre id="universal-error-text" style="flex:1;overflow:auto;white-space:pre-wrap;font-size:12px;color:#ffaaaa;background:#111;padding:10px;border-radius:5px;"></pre>
    `;
    document.body.appendChild(modal);
  }
  document.getElementById('universal-error-text').textContent += msg + " | ";
}

window.onerror = function(msg, url, line) { showUniversalError("JS ERROR: " + msg + " | Line: " + line + " | File: " + url); };
window.addEventListener('unhandledrejection', function(e) { showUniversalError("PROMISE: " + (e.reason ? e.reason.message || e.reason : "Unknown")); });

// --- FETCH SIGNALS ---
async function fetchSignals() {
  const list = document.getElementById('signal-list');
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('signals').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    signalsData = data || [];
    renderSignals();
  } catch (err) {
    // silent fail on background sync
  }
}

// --- SYNC LIVE TRADES ---
async function syncLiveTrades() {
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
    const data = await res.json();
    if (data.positions) {
      liveTrades = data.positions;
      renderSignals();
    }
  } catch (err) { 
    console.error("Sync failed"); 
  }
}

// --- MATCHING LOGIC ---
function getLiveTradeForSignal(s, used) {
  used = used || new Set();
  
  // 1. STRICT: If signal has a deal_id, it MUST match exactly and only once
  if (s.deal_id) {
    const m = liveTrades.find(p => 
      (p.position.dealId === s.deal_id || p.position.workingOrderId === s.deal_id) && 
      !used.has(p.position.dealId)
    );
    if (m) return m;
  }
  
  // 2. LOOSE: Only if no deal_id exists, try price matching
  const getNum = (val) => parseFloat(String(val).replace(/[^0-9.-]+/g,""));
  const sEntry = getNum(s.entry);
  
  if (!sEntry || !Number.isFinite(sEntry)) return null;
  
  return liveTrades.find(p => {
    if (used.has(p.position.dealId)) return false;
    const epicMatch = (p.market.epic === s.asset || (p.market.epic === 'GOLD' && s.asset === 'XAUUSD'));
    if (!epicMatch || p.position.direction !== s.direction) return false;
    const pLevel = p.position.level || p.position.openLevel;
    if (!pLevel) return false;
    return Math.abs(pLevel - sEntry) < 5.0; // Wider tolerance
  }) || null;
}

// --- RENDER UI ---
function renderSignals() {
  const list = document.getElementById('signal-list');
  if (!list) return;
  
  // Save expanded state before rebuild
  const expandedIds = [];
  list.querySelectorAll('.card.exp').forEach(c => expandedIds.push(c.dataset.id));
  
  const usedDealIds = new Set();
  list.innerHTML = signalsData.map(s => {
    const live = getLiveTradeForSignal(s, usedDealIds);
    if (live && live.position && live.position.dealId) usedDealIds.add(live.position.dealId);
    const isLive = !!live;
    const livePnl = isLive ? parseFloat(live.position.upl) : 0;

    const isClosed = s.result === 'win' || s.result === 'loss';
    const statusClass = isLive ? 'open' : isClosed ? 'closed' : 'pending';
    
    const badgeHtml = isLive 
      ? '<span class="badge open"><i></i>OPEN</span>' 
      : isClosed 
        ? '<span class="badge closed">CLOSED</span>' 
        : '<span class="badge pending"><i></i>WAITING</span>';

    const displayPnl = isLive ? livePnl : (s.pnl !== undefined && s.pnl !== null ? parseFloat(s.pnl) : null);
    const pnlHtml = displayPnl !== null 
      ? `<span class="num ${displayPnl >= 0 ? 'pos' : 'neg'}" style="font-size: 14px; font-family: var(--mono); font-weight: bold; color: ${displayPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${displayPnl >= 0 ? '+' : '-'}$${Math.abs(displayPnl).toFixed(2)}</span>` 
      : '';

    const slN = parseFloat(s.sl), entryN = parseFloat(s.entry), tpN = parseFloat(s.tp);
    let rrDisplay = '';
    if (Number.isFinite(slN) && Number.isFinite(entryN) && Number.isFinite(tpN)) {
      const risk = Math.abs(entryN - slN);
      const reward = Math.abs(tpN - entryN);
      if (risk > 0) rrDisplay = 'RR 1:' + (reward / risk).toFixed(1);
    }

    const fixedPrices = [slN, entryN, tpN].filter(Number.isFinite);
    const min = Math.min(...fixedPrices); const max = Math.max(...fixedPrices);
    const range = (max - min) || 1;
    const pctSL = ((slN - min) / range) * 100;
    const pctEntry = ((entryN - min) / range) * 100;
    const pctTP = ((tpN - min) / range) * 100;
    const liveBid = live ? parseFloat(live.market.bid) : null;
    let pctLive = (liveBid !== null && Number.isFinite(liveBid)) ? ((liveBid - min) / range) * 100 : null;
    if (pctLive !== null) pctLive = Math.max(0, Math.min(100, pctLive));
    const leftPin = Math.min(pctSL, pctTP);
    const rightPin = Math.max(pctSL, pctTP);

    const time = new Date(s.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const directionText = s.direction === 'BUY' ? 'price expected to rise' : 'price expected to fall';
    
    const isGold = s.asset.includes('XAU') || s.asset.includes('GOLD');
    const isSilver = s.asset.includes('XAG') || s.asset.includes('SILVER');
    const assetIcon = isGold ? '<span style="font-size:18px; margin-right:4px;">🪙</span>' : isSilver ? '<span style="font-size:18px; margin-right:4px;">🥈</span>' : '';

    return `
    <article class="card ${statusClass}" data-id="${s.id}" onclick="this.classList.toggle('exp')">
      <div class="head">
        <div class="h-left">
          <div class="pair" style="display:flex; align-items:center; flex-wrap:nowrap; font-size: 16px !important;">
            <span style="display:flex; align-items:center;">${assetIcon}${s.asset}</span>
            <span class="side ${s.direction.toLowerCase()}" style="margin-left:6px; flex-shrink:0; font-size:9px; padding:2px 5px;">${s.direction}</span>
            <span style="font-size: 11px; font-family: var(--mono); color: var(--muted); font-weight: normal; margin-left: 6px; white-space:nowrap;">${rrDisplay}</span>
          </div>
          <div class="meta">${time} · ${directionText}</div>
        </div>
        <div class="h-right" style="display:flex; align-items:flex-start; gap:8px;">
          <div class="pl" style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
            ${isLive ? `<span style="font-size: 13px; font-family: var(--mono); color: #00E5FF;">${liveBid}</span>` : ''}
            ${pnlHtml}
            ${badgeHtml}
          </div>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top:4px;"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      
      <div class="body">
        <div class="bar-wrap" style="padding-top: 14px; padding-bottom: 0px;">
          <div class="price-track">
            <div class="zone-sl" style="width: ${leftPin}%;"></div>
            <div class="zone-tp" style="width: ${100 - rightPin}%; margin-left: ${rightPin}%;"></div>
            
            <div class="pin" style="left: ${pctSL}%;">
              <span class="pin-label" style="top: -25px;">${s.sl}</span>
              <span class="pin-label" style="top: 14px; font-size: 9px; color: var(--muted);">SL</span>
            </div>
            
            <div class="pin" style="left: ${pctTP}%;">
              <span class="pin-label" style="top: -25px;">${s.tp}</span>
              <span class="pin-label" style="top: 14px; font-size: 9px; color: var(--muted);">TP</span>
            </div>

            <div class="pin entry" style="left: ${pctEntry}%;">
              <span class="pin-label" style="top: -25px; color: #fff;">${s.entry}</span>
              <span class="pin-label" style="top: 14px; font-size: 9px; color: var(--muted);">ENTRY</span>
            </div>
            
            ${pctLive !== null ? `
              <div class="pin live" style="left: ${pctLive}%;"></div>
            ` : ''}
          </div>
        </div>

        <div style="display:flex; margin-bottom:14px; border-bottom:1px solid var(--line); margin-top:14px;">
          <button class="tab-btn" onclick="event.stopPropagation(); switchTab('${s.id}', 'chart')" id="tab-chart-${s.id}" style="flex:1; padding:8px 4px; background:none; border:none; color:var(--muted); font-weight:600; font-size:12px; border-bottom:2px solid transparent; display:flex; align-items:center; justify-content:center; gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg> Chart
          </button>
          <button class="tab-btn" onclick="event.stopPropagation(); switchTab('${s.id}', 'analysis')" id="tab-analysis-${s.id}" style="flex:1; padding:8px 4px; background:none; border:none; color:var(--muted); font-weight:600; font-size:12px; border-bottom:2px solid transparent; display:flex; align-items:center; justify-content:center; gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg> Analysis
          </button>
        </div>
        <div id="content-chart-${s.id}" style="display:none; margin-bottom:14px;">
          <img src="${s.image_url || ''}" style="width:100%; border-radius:12px; border:1px solid var(--line);" onerror="this.style.display='none'">
        </div>
        <div id="content-analysis-${s.id}" style="display:none; margin-bottom:14px; padding:12px; background:var(--bg2); border:1px solid var(--line); border-radius:12px; font-size:14px; color:#cfd9e4; line-height:1.5;">
          ${s.analysis || 'No analysis.'}
        </div>

        <div class="actions" style="margin-top:14px; display:flex; justify-content:space-between; gap:6px;">
          ${isLive ? `
            <button class="act danger" style="display:flex; align-items:center; justify-content:center; gap:4px; font-size:11px; padding:6px 12px; height:32px; white-space:nowrap;" onclick="event.stopPropagation(); closeTrade('${s.id}', '${live.position.dealId}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Close
            </button>
            <button class="act ghost" style="display:flex; align-items:center; justify-content:center; gap:4px; font-size:11px; padding:6px 12px; height:32px; white-space:nowrap;" onclick="event.stopPropagation(); openScaleOutModal('${s.id}', '${live.position.dealId}', ${live.position.size}, '${live.position.direction}', '${live.market.epic}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Scale Out
            </button>
            <button class="act ghost" style="display:flex; align-items:center; justify-content:center; gap:4px; font-size:11px; padding:6px 12px; height:32px; white-space:nowrap;" onclick="event.stopPropagation(); alert('Share coming soon')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98m-.01-10.98l-6.82 3.98"/></svg> Share
            </button>
          ` : isClosed ? `
            <button class="act ghost" style="width:100%; padding:6px 12px; height:32px;">Closed (${s.result.toUpperCase()})</button>
          ` : `
            <button class="act danger" style="flex:1; background:#00FF66; color:#0a0e13; border:none; box-shadow:0 0 15px rgba(0,255,102,0.3); display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px; font-weight:bold;" onclick="event.stopPropagation(); executeTrade('${s.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Execute
            </button>
            <button class="act ghost" style="flex:1; color:var(--red); border-color:rgba(255,90,79,.3); display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px;" onclick="event.stopPropagation(); deleteSignal('${s.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Delete
            </button>
            <button class="act ghost" style="display:flex; align-items:center; justify-content:center; gap:4px; font-size:11px; padding:6px 12px; height:32px; white-space:nowrap;" onclick="event.stopPropagation(); alert('Share coming soon')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98m-.01-10.98l-6.82 3.98"/></svg> Share
            </button>
          `}
        </div>
      </div>
    </article>`;
  }).join('') || '<div class="empty"><b>Nothing here yet</b>Tap “Post Signal” to add a trade.</div>';
  
  // Restore expanded state
  expandedIds.forEach(id => {
    const card = list.querySelector(`.card[data-id="${id}"]`);
    if (card) card.classList.add('exp');
  });
  updateSummaryStats();
  applyFilter(currentFilter);
}
function switchTab(id, tab) {
  const chartBtn = document.getElementById('tab-chart-' + id);
  const analysisBtn = document.getElementById('tab-analysis-' + id);
  const chartContent = document.getElementById('content-chart-' + id);
  const analysisContent = document.getElementById('content-analysis-' + id);
  if (!chartBtn) return;

  const isChartVisible = chartContent.style.display === 'block';
  const isAnalysisVisible = analysisContent.style.display === 'block';

  if (tab === 'chart' && isChartVisible) {
    chartContent.style.display = 'none'; chartBtn.style.color = 'var(--muted)'; chartBtn.style.borderBottom = '2px solid transparent'; return;
  }
  if (tab === 'analysis' && isAnalysisVisible) {
    analysisContent.style.display = 'none'; analysisBtn.style.color = 'var(--muted)'; analysisBtn.style.borderBottom = '2px solid transparent'; return;
  }

  if (tab === 'chart') {
    chartBtn.style.color = 'var(--amber)'; chartBtn.style.borderBottom = '2px solid var(--amber)';
    analysisBtn.style.color = 'var(--muted)'; analysisBtn.style.borderBottom = '2px solid transparent';
    chartContent.style.display = 'block'; analysisContent.style.display = 'none';
  } else {
    analysisBtn.style.color = 'var(--amber)'; analysisBtn.style.borderBottom = '2px solid var(--amber)';
    chartBtn.style.color = 'var(--muted)'; chartBtn.style.borderBottom = '2px solid transparent';
    chartContent.style.display = 'none'; analysisContent.style.display = 'block';
  }
}

// --- ACTIONS ---
async function executeTrade(id) {
  const sig = signalsData.find(s => s.id === id);
  if (!sig) return;

  let lotModal = document.getElementById('lot-size-modal');
  if (!lotModal) {
    lotModal = document.createElement('div');
    lotModal.id = 'lot-size-modal';
    document.body.appendChild(lotModal);
  }

  lotModal.className = 'app-modal-overlay';
  lotModal.innerHTML = `
    <div style="background:#0c1220; border:1px solid rgba(120,150,200,0.16); border-radius:20px; padding:24px; width:100%; max-width:360px; box-shadow:0 20px 50px rgba(0,0,0,0.9);">
      <h2 style="color:#fff; font-size:22px; font-weight:700; margin-bottom:8px;">Execute Trade</h2>
      <p style="color:#8e9bb3; font-size:14px; margin-bottom:16px;">${sig.direction} ${sig.asset}</p>
      
      <label style="display:block; font-size:11px; font-weight:700; color:#8e9bb3; text-transform:uppercase; margin-bottom:6px;">Lot Size</label>
      <input type="number" id="lot-size-input" step="0.01" value="1.0" style="width:100%; background:#0f1627; border:1px solid rgba(120,150,200,0.16); border-radius:12px; padding:14px; color:#fff; font-family:'JetBrains Mono',monospace; font-size:20px; text-align:center; margin-bottom:20px; outline:none;">
      
      <div style="display:flex; gap:10px;">
        <button onclick="document.getElementById('lot-size-modal').remove()" style="flex:1; padding:14px; border-radius:12px; font-weight:700; font-size:15px; border:1px solid rgba(120,150,200,0.16); background:#0f1627; color:#fff;">Cancel</button>
        <button id="confirm-lot-btn" style="flex:1; padding:14px; border-radius:12px; font-weight:700; font-size:15px; border:none; background:#22e58f; color:#000;">Confirm</button>
      </div>
    </div>
  `;

  document.getElementById('confirm-lot-btn').onclick = async () => {
    const lotSize = parseFloat(document.getElementById('lot-size-input').value);
    if (!lotSize || lotSize <= 0) return alert("Please enter a valid lot size.");
    
    lotModal.remove();

    try {
      const res = await fetch(EXECUTE_ENDPOINT, { 
        method: 'POST', 
        headers: { 'Content-Type': 'text/plain' }, 
        body: JSON.stringify({ 
          action: 'execute_trade', 
          epic: sig.asset === 'XAUUSD' ? 'GOLD' : sig.asset, 
          direction: sig.direction, 
          size: lotSize, 
          stopLevel: sig.sl, 
          profitLevel: sig.tp 
        }) 
      });
      
      const data = await res.json();
      
      if (data.dealReference || data.dealId) {
        setTimeout(async () => {
          const syncRes = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
          const syncData = await syncRes.json();
          
          if (syncData.positions && syncData.positions.length > 0) {
            const { data: allSignals } = await supabaseClient.from('signals').select('deal_id').not('deal_id', 'is', null);
            const usedDealIds = new Set((allSignals || []).map(s => s.deal_id));
            
            const matchingPos = syncData.positions.find(p => {
              const epicMatch = p.market.epic === sig.asset || (p.market.epic === 'GOLD' && sig.asset === 'XAUUSD');
              return epicMatch && p.position.direction === sig.direction && !usedDealIds.has(p.position.dealId);
            });
            
            if (matchingPos) {
              await supabaseClient.from('signals').update({ deal_id: matchingPos.position.dealId }).eq('id', sig.id);
            } else {
              console.warn("Could not find an unlinked matching trade.");
            }
          }
          syncLiveTrades();
        }, 2000);
      } else {
        alert("Execution Failed: " + JSON.stringify(data));
      }
    } catch (err) { 
      alert("Execution failed: " + err.message); 
    }
  };
}
async function closeTrade(signalId, dealId) {
  if (!dealId) return alert("No deal ID.");
  if (!confirm('Close position?')) return;
  
  const live = liveTrades.find(p => p.position.dealId === dealId);
  const pnl = live ? parseFloat(live.position.upl) : 0;
  const finalResult = pnl >= 0 ? 'win' : 'loss';
  
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'close_position', dealId: dealId }) });
    const data = await res.json();
    
    if (data.success || data.dealReference || data.dealId) {
      await supabaseClient.from('signals').update({ 
        result: finalResult, 
        deal_id: null,
        pnl: pnl
      }).eq('id', signalId);
      
      alert("Position closed. P/L: " + (pnl >= 0 ? '+' : '') + "$" + pnl.toFixed(2));
      syncLiveTrades(); 
      fetchSignals();
    } else {
      alert("Close failed: " + JSON.stringify(data));
    }
  } catch (err) { 
    alert("Close failed: " + err.message); 
  }
}

async function deleteSignal(id) {
  if (confirm('Delete permanently?')) {
    await supabaseClient.from('signals').delete().eq('id', id);
    fetchSignals();
  }
}

// --- MODAL & FORM ---
function toggleSignalModal() {
  const modal = document.getElementById('signal-modal');
  if (!modal) return;
  
  const isOpen = modal.style.display === 'flex';
  
  if (isOpen) {
    modal.style.display = 'none';
    return;
  }
  
  document.getElementById('signal-form').reset();
  document.getElementById('sig-direction').value = 'BUY';
  setSigDir('BUY');
  document.getElementById('sig-image-preview-container').style.display = 'none';
  document.getElementById('manual-fields').style.display = 'none';
  modal.style.display = 'flex';
}
function setSigDir(dir) {
  // 1. Update the global variable
  currentSigDir = dir;
  
  // 2. Force update the hidden input (the actual source of truth for submission)
  const hiddenInput = document.getElementById('sig-direction');
  if (hiddenInput) hiddenInput.value = dir;

  // 3. Update UI
  const b = document.getElementById('sig-btn-buy');
  const s = document.getElementById('sig-btn-sell');
  if (!b || !s) return;
  
  if (dir === 'BUY') {
    b.style.border = '1px solid var(--green)';
    b.style.background = 'rgba(25,230,140,0.1)';
    b.style.color = 'var(--green)';
    s.style.border = '1px solid transparent';
    s.style.background = 'transparent';
    s.style.color = 'var(--muted)';
  } else {
    s.style.border = '1px solid var(--red)';
    s.style.background = 'rgba(255,90,79,0.1)';
    s.style.color = 'var(--red)';
    b.style.border = '1px solid transparent';
    b.style.background = 'transparent';
    b.style.color = 'var(--muted)';
  }
}

// --- INIT & LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('signal-list');
  if (!window.supabase) {
    if (list) list.innerHTML = '<div style="color: #ff4d4d; padding: 20px; text-align: center;">Supabase library failed to load. Check internet.</div>';
    return;
  }
  
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  // Load signals and live trades FIRST
  fetchSignals();
  syncLiveTrades().then(() => {
    // AFTER trades are loaded, get the balance
    fetchAccountBalance();
  });
  
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => { 
    fetchSignals(); 
    syncLiveTrades().then(() => fetchAccountBalance());
  }, 30000);

  // Bind Post Button
  const postBtn = document.getElementById('btnPost');
  if (postBtn) postBtn.onclick = toggleSignalModal;
  
  // Bind Form Submit
  const form = document.getElementById('signal-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      btn.innerText = "Publishing..."; btn.disabled = true;
      const asset = document.getElementById('sig-asset').value.toUpperCase().trim();
      const cat = document.getElementById('sig-cat').value;
      const entry = document.getElementById('sig-entry').value;
      const sl = document.getElementById('sig-sl').value;
      const tp = document.getElementById('sig-tp').value;
      const analysis = document.getElementById('sig-notes').value.trim();
      const fileInput = document.getElementById('sig-image-input');
      let imageUrl = null;
      try {
        if (fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
          const { error: uploadError } = await supabaseClient.storage.from('charts').upload(fileName, file);
          if (uploadError) throw uploadError;
          const { data: publicUrlData } = supabaseClient.storage.from('charts').getPublicUrl(fileName);
          imageUrl = publicUrlData.publicUrl;
        }
        // Read direction directly from the hidden input
        const finalDir = document.getElementById('sig-direction').value;
        const { error: insertError } = await supabaseClient.from('signals').insert([{ asset, category: cat, direction: finalDir, entry, sl, tp, analysis, image_url: imageUrl, result: 'pending' }]);
        if (insertError) throw insertError;
        toggleSignalModal();
        fetchSignals();
      } catch (err) { alert("Failed: " + err.message); }
      finally { btn.innerText = "Publish Signal"; btn.disabled = false; }
    };
  }

  // Bind File Upload
  const fileInput = document.getElementById('sig-image-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        const img = new Image();
        img.onload = async function() {
          const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = img.height * (800 / img.width);
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Data = canvas.toDataURL('image/jpeg', 0.7);
          document.getElementById('sig-image-preview').src = base64Data;
          document.getElementById('sig-image-preview-container').style.display = 'block';
          document.getElementById('sig-image-loading').style.display = 'flex';
          const notesArea = document.getElementById('sig-notes'); notesArea.value = "🤖 AI is reading the chart..."; notesArea.disabled = true;
          try {
            const res = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'analyze_chart', image: base64Data }) });
            const text = await res.text(); let data; try { data = JSON.parse(text); } catch { throw new Error("Invalid server response."); }
            if(data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
            if (data.asset) document.getElementById('sig-asset').value = data.asset.toUpperCase();
            if (data.category) { const catSelect = document.getElementById('sig-cat'); catSelect.value = data.category.charAt(0).toUpperCase() + data.category.slice(1).toLowerCase(); }
            if (data.entry) { document.getElementById('sig-entry').value = data.entry; document.getElementById('sig-entry-display').value = data.entry; }
            if (data.sl) { document.getElementById('sig-sl').value = data.sl; document.getElementById('sig-sl-display').value = data.sl; }
            if (data.tp) { document.getElementById('sig-tp').value = data.tp; document.getElementById('sig-tp-display').value = data.tp; }
            setSigDir(data.direction && data.direction.toUpperCase() === 'SELL' ? 'SELL' : 'BUY');
            notesArea.value = data.analysis ? data.analysis.replace(/\*/g, '') : "AI finished, but no analysis text returned.";
          } catch (err) { notesArea.value = "Error: " + err.message; }
          finally { notesArea.disabled = false; document.getElementById('manual-fields').style.display = 'flex'; document.getElementById('sig-image-loading').style.display = 'none'; }
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };
  }
});

// --- UPDATE SUMMARY STATS ---
function updateSummaryStats() {
  let totalPnl = 0;
  let openCount = 0;
  let pendingCount = 0;
  let wins = 0;
  let closedCount = 0;

  // Calculate PnL and Open count from liveTrades
  liveTrades.forEach(p => {
    totalPnl += parseFloat(p.position.upl || 0);
    openCount++;
  });

  // Calculate Pending, Wins, Closed from signalsData
  signalsData.forEach(s => {
    if (s.result === 'win') { wins++; closedCount++; }
    else if (s.result === 'loss') { closedCount++; }
    else if (s.result === 'pending') { 
      // Only count as pending if it's NOT live
      const isLive = liveTrades.some(p => p.position.dealId === s.deal_id);
      if (!isLive) pendingCount++;
    }
  });

  const winRate = closedCount > 0 ? Math.round((wins / closedCount) * 100) : 0;

  // Update DOM elements
  const elTotal = document.getElementById('ui-total-pl');
  const elOpen = document.getElementById('ui-open');
  const elPending = document.getElementById('ui-pending');
  const elWinRate = document.getElementById('ui-winrate');
  const elUpd = document.getElementById('ui-upd');

  const elBalance = document.getElementById('ui-balance');
  if (elBalance) elBalance.innerText = '$' + accountBalance.toFixed(2);
  
  // elWinRate already declared above
  if (elWinRate) elWinRate.innerText = winRate + '%';
  
  if (elTotal) {
    elTotal.innerText = (totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2);
    elTotal.className = 'num ' + (totalPnl >= 0 ? 'pos' : 'neg');
  }
  if (elOpen) elOpen.innerText = openCount;
  if (elPending) elPending.innerText = pendingCount;
  if (elWinRate) elWinRate.innerText = winRate + '%';
  if (elUpd) elUpd.innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

  // Update filter counts
  const cntAll = document.getElementById('ui-cnt-all');
  const cntOpen = document.getElementById('ui-cnt-open');
  const cntPending = document.getElementById('ui-cnt-pending');
  const cntClosed = document.getElementById('ui-cnt-closed');

  if (cntAll) cntAll.innerText = signalsData.length;
  if (cntOpen) cntOpen.innerText = openCount;
  if (cntPending) cntPending.innerText = pendingCount;
  if (cntClosed) cntClosed.innerText = closedCount;

  // Update new Win Rate card
  const elWins = document.getElementById('ui-wins');
  if (elWins) elWins.innerText = wins;
}

// --- FILTER LOGIC ---
let currentFilter = 'all';

function applyFilter(filter) {
  currentFilter = filter;
  
  // 1. Update chip styles
  document.querySelectorAll('.chip').forEach(c => {
    if (c.dataset.f === filter) {
      c.style.background = 'var(--cyan-bg)';
      c.style.borderColor = 'var(--cyan)';
      c.style.color = 'var(--cyan)';
    } else {
      c.style.background = 'var(--card)';
      c.style.borderColor = 'var(--line)';
      c.style.color = 'var(--muted)';
    }
  });

  // 2. Filter the cards visually
  document.querySelectorAll('.card').forEach(card => {
    // Check the classes applied to the card
    if (filter === 'all') {
      card.style.display = '';
    } else if (filter === 'open' && card.classList.contains('open')) {
      card.style.display = '';
    } else if (filter === 'pending' && card.classList.contains('pending')) {
      card.style.display = '';
    } else if (filter === 'closed' && card.classList.contains('closed')) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Bind filter chips
  document.querySelectorAll('.chip').forEach(c => {
    c.onclick = (e) => {
      e.preventDefault();
      applyFilter(c.dataset.f);
    };
  });
});

async function fetchAccountBalance() {
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { 
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, 
      body: JSON.stringify({ action: 'get_account' }) 
    });
    const data = await res.json();
    if (data.accounts && data.accounts.length > 0) {
      accountBalance = parseFloat(data.accounts[0].balance.balance);
      updateSummaryStats(); // Refresh UI
    }
  } catch (e) { console.error("Balance fetch failed", e); }
}


async function openAccountInfo() {
  let modal = document.getElementById('account-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'account-modal';
    document.body.appendChild(modal);
  }

  modal.className = 'app-modal-overlay';
  modal.innerHTML = `
    <div class="app-modal-card">
      <h2 class="app-modal-title">Account Info</h2>
      <p class="app-modal-sub">Loading...</p>
    </div>
  `;

  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'get_account' }) });
    const data = await res.json();

    if (data.accounts && data.accounts.length > 0) {
      const acc = data.accounts[0];
      const bal = acc.balance;
      
      modal.innerHTML = `
        <div class="app-modal-card">
          <h2 class="app-modal-title">Account Info</h2>
          
          <div style="background: var(--panel2); border-radius: 12px; padding: 14px; margin-bottom: 10px;">
            <p style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Balance</p>
            <p style="font-size:24px; font-weight:700; font-family:var(--mono); color:#fff;">$${parseFloat(bal.balance).toFixed(2)}</p>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
            <div style="background: var(--panel2); border-radius: 12px; padding: 12px;">
              <p style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Available</p>
              <p style="font-size:16px; font-weight:700; font-family:var(--mono); color:#fff;">$${parseFloat(bal.available).toFixed(2)}</p>
            </div>
            <div style="background: var(--panel2); border-radius: 12px; padding: 12px;">
              <p style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Profit / Loss</p>
              <p style="font-size:16px; font-weight:700; font-family:var(--mono); color:${parseFloat(bal.profitLoss) >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${parseFloat(bal.profitLoss) >= 0 ? '+' : ''}$${parseFloat(bal.profitLoss).toFixed(2)}
              </p>
            </div>
          </div>

          <button onclick="document.getElementById('account-modal').remove()" class="app-modal-cancel" style="width:100%;">Close</button>
        </div>
      `;
    } else {
      alert("No account data received.");
      modal.remove();
    }
  } catch (err) {
    alert("Failed to fetch account info: " + err.message);
    modal.remove();
  }
}

async function openScaleOutModal(signalId, dealId, currentSize, direction, epic) {
  let modal = document.getElementById('scale-out-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'scale-out-modal';
    document.body.appendChild(modal);
  }

  const size25 = (currentSize * 0.75).toFixed(2);
  const size50 = (currentSize * 0.50).toFixed(2);
  const size75 = (currentSize * 0.25).toFixed(2);
  const isTooSmall = currentSize <= 0.01;

  modal.innerHTML = `
    <div style="background:#0c1220; border:1px solid rgba(120,150,200,0.16); border-radius:20px; padding:24px; width:100%; max-width:360px; box-shadow:0 20px 50px rgba(0,0,0,0.9);">
      <h2 style="color:#fff; font-size:22px; font-weight:700; margin-bottom:8px;">Scale Out</h2>
      <p style="color:#8e9bb3; font-size:14px; margin-bottom:16px;">Current Size: <b>${currentSize} Lots</b></p>
      
      ${isTooSmall ? `
        <div style="background:rgba(255,176,32,0.1); border:1px solid #f5b53d; border-radius:12px; padding:12px; margin-bottom:16px;">
          <p style="color:#f5b53d; font-size:12px;">⚠️ Trade too small to split. Use Close All.</p>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
        <button onclick="executePartialClose('${signalId}', '${dealId}', ${size25})" ${isTooSmall ? 'disabled' : ''} style="padding:14px; background:#0f1627; border:1px solid rgba(120,150,200,0.16); border-radius:12px; color:${isTooSmall ? '#5d6b7d' : '#fff'}; font-weight:700; font-size:14px;">25%<br><span style="font-size:10px; color:#8e9bb3;">Remaining: ${size25}</span></button>
        <button onclick="executePartialClose('${signalId}', '${dealId}', ${size50})" ${isTooSmall ? 'disabled' : ''} style="padding:14px; background:#0f1627; border:1px solid rgba(120,150,200,0.16); border-radius:12px; color:${isTooSmall ? '#5d6b7d' : '#fff'}; font-weight:700; font-size:14px;">50%<br><span style="font-size:10px; color:#8e9bb3;">Remaining: ${size50}</span></button>
        <button onclick="executePartialClose('${signalId}', '${dealId}', ${size75})" ${isTooSmall ? 'disabled' : ''} style="padding:14px; background:#0f1627; border:1px solid rgba(120,150,200,0.16); border-radius:12px; color:${isTooSmall ? '#5d6b7d' : '#fff'}; font-weight:700; font-size:14px;">75%<br><span style="font-size:10px; color:#8e9bb3;">Remaining: ${size75}</span></button>
        <button onclick="closeTrade('${signalId}', '${dealId}')" style="padding:14px; background:#ff4d4d; border:1px solid #ff4d4d; border-radius:12px; color:#fff; font-weight:700; font-size:14px;">Close All<br><span style="font-size:10px; color:rgba(255,255,255,0.7);">Full size</span></button>
      </div>

      <button onclick="document.getElementById('scale-out-modal').remove()" style="width:100%; padding:14px; background:#0f1627; border:1px solid rgba(120,150,200,0.16); border-radius:12px; color:#fff; font-weight:700; font-size:14px;">Cancel</button>
    </div>
  `;
}

async function executePartialClose(signalId, dealId, newSize) {
  document.getElementById('scale-out-modal').remove();
  alert("Resizing trade to " + newSize + " lots...");
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { 
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, 
      body: JSON.stringify({ action: 'partial_close', dealId: dealId, newSize: parseFloat(newSize) }) 
    });
    const data = await res.json();
    if (data.success) {
      alert("Resized to " + newSize + " lots.");
      syncLiveTrades();
    } else {
      alert("Failed: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
}
