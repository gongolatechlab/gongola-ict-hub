const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXl5Y3F3Z2R5a2xmenJpbnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTg5NjYsImV4cCI6MjEwOTE5NDk2Nn0.jgEo3bvyKK_ak1yMRILX-32tCrg8BKSlzDvu-ccDq3w';
const AI_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";
const EXECUTE_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";

let supabaseClient = null;
let signalsData = [];
let liveTrades = [];
let currentSigDir = 'BUY';
let syncInterval = null;

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
  if (s.deal_id) {
    const m = liveTrades.find(p => (p.position.dealId === s.deal_id || p.position.workingOrderId === s.deal_id) && !used.has(p.position.dealId));
    if (m) return m;
  }
  const getNum = (val) => parseFloat(String(val).replace(/[^0-9.-]+/g,""));
  const sEntry = getNum(s.entry), sSL = getNum(s.sl), sTP = getNum(s.tp);
  return liveTrades.find(p => {
    if (used.has(p.position.dealId)) return false;
    const epicMatch = (p.market.epic === s.asset || (p.market.epic === 'GOLD' && s.asset === 'XAUUSD'));
    if (!epicMatch || p.position.direction !== s.direction) return false;
    const pLevel = p.position.level || p.position.openLevel;
    if (!pLevel || !sEntry) return false;
    const pSL = p.position.stopLevel; const pTP = p.position.profitLevel;
    const priceMatch = Math.abs(pLevel - sEntry) < 0.5;
    const slMatch = !pSL || !sSL || Math.abs(pSL - sSL) < 0.5;
    const tpMatch = !pTP || !sTP || Math.abs(pTP - sTP) < 0.5;
    return priceMatch && slMatch && tpMatch;
  });
}

// --- RENDER UI ---
function renderSignals() {
  const list = document.getElementById('signal-list');
  if (!list) return;
  
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

    const displayPnl = isLive ? livePnl : (s.result === 'win' ? 100 : s.result === 'loss' ? -100 : null);
    const pnlHtml = displayPnl !== null 
      ? `<b class="num ${displayPnl >= 0 ? 'pos' : 'neg'}">${displayPnl >= 0 ? '+' : '-'}$${Math.abs(displayPnl).toFixed(2)}</b>` 
      : `<b class="num" style="color:var(--muted)">—</b>`;

    const slN = parseFloat(s.sl), entryN = parseFloat(s.entry), tpN = parseFloat(s.tp);
    let rrDisplay = '—';
    if (Number.isFinite(slN) && Number.isFinite(entryN) && Number.isFinite(tpN)) {
      let risk = 0;
      let reward = 0;
      
      if (s.direction === 'BUY') {
        risk = entryN - slN; // For a BUY, SL is below Entry
        reward = tpN - entryN; // TP is above Entry
      } else {
        risk = slN - entryN; // For a SELL, SL is above Entry
        reward = entryN - tpN; // TP is below Entry
      }
      
      // Only calculate RR if the risk and reward are positive numbers
      if (risk > 0 && reward > 0) {
        rrDisplay = '1 → ' + (reward / risk).toFixed(1);
      }
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

    return `
    <article class="card ${statusClass}" data-id="${s.id}" onclick="this.classList.toggle('exp')">
      <div class="head">
        <div class="h-left">
          <div class="pair">${s.asset}<span class="side ${s.direction.toLowerCase()}">${s.direction}</span></div>
          <div class="meta">${time} · ${directionText}</div>
        </div>
        <div class="h-right">
          <div class="pl">${pnlHtml}${badgeHtml}</div>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      
      <div class="body">
        
        <div class="bar-wrap">
          <div class="price-track">
            <div class="zone-sl" style="width: ${leftPin}%;"></div>
            <div class="zone-tp" style="width: ${100 - rightPin}%; margin-left: ${rightPin}%;"></div>
            <div class="pin" style="left: ${pctSL}%;"><span class="pin-label">SL</span></div>
            <div class="pin entry" style="left: ${pctEntry}%;"><span class="pin-label">ENTRY</span></div>
            <div class="pin" style="left: ${pctTP}%;"><span class="pin-label">TP</span></div>
            ${pctLive !== null ? `<div class="pin live" style="left: ${pctLive}%;"><span class="pin-label" style="color:#00E5FF; top:10px;">LIVE</span></div>` : ''}
          </div>
          <div class="bar-bot num">
            ${s.direction === 'BUY' ? `
              <span><em>SL</em>${s.sl}</span>
              <span><em>Entry</em>${s.entry}</span>
              <span><em>TP</em>${s.tp}</span>
            ` : `
              <span><em>TP</em>${s.tp}</span>
              <span><em>Entry</em>${s.entry}</span>
              <span><em>SL</em>${s.sl}</span>
            `}
          </div>
        </div>

        <div style="display:flex; margin-bottom:12px; border-bottom:1px solid var(--line); margin-top:16px;">
          <button onclick="event.stopPropagation(); switchTab('${s.id}', 'chart')" id="tab-chart-${s.id}" style="flex:1; padding:10px; background:none; border:none; color:var(--muted); font-weight:bold; border-bottom:2px solid transparent;">Chart</button>
          <button onclick="event.stopPropagation(); switchTab('${s.id}', 'analysis')" id="tab-analysis-${s.id}" style="flex:1; padding:10px; background:none; border:none; color:var(--muted); font-weight:bold; border-bottom:2px solid transparent;">Analysis</button>
        </div>
        <div id="content-chart-${s.id}" style="display:none;">
          <img src="${s.image_url || ''}" style="width:100%; border-radius:12px; border:1px solid var(--line);" onerror="this.style.display='none'">
        </div>
        <div id="content-analysis-${s.id}" style="display:none; padding:12px; background:var(--bg2); border:1px solid var(--line); border-radius:12px; font-size:14px; color:#cfd9e4; line-height:1.5;">
          ${s.analysis || 'No analysis.'}
        </div>

        <div class="actions" style="margin-top:16px;">
          ${isLive ? `
            <button class="act danger" onclick="event.stopPropagation(); closeTrade('${s.id}', '${live.position.dealId}')">Close</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Scale Out coming soon')">Scale Out</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Share coming soon')">Share</button>
          ` : isClosed ? `
            <button class="act ghost" style="grid-column: span 3;">Closed (${s.result.toUpperCase()})</button>
          ` : `
            <button class="act danger" style="background:var(--green); color:#000; border-color:var(--green);" onclick="event.stopPropagation(); executeTrade('${s.id}')">Execute</button>
            <button class="act ghost" style="color:var(--red); border-color:rgba(255,90,79,.3);" onclick="event.stopPropagation(); deleteSignal('${s.id}')">Delete</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Share coming soon')">Share</button>
          `}
        </div>
      </div>
    </article>`;
  }).join('') || '<div class="empty"><b>Nothing here yet</b>Tap “Post Signal” to add a trade.</div>';
  updateSummaryStats();
  applyFilter(currentFilter);
}

// --- TABS ---
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
  if (!confirm(`Execute ${sig.direction} ${sig.asset}?`)) return;
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'execute_trade', epic: sig.asset === 'XAUUSD' ? 'GOLD' : sig.asset, direction: sig.direction, size: 1.0, stopLevel: sig.sl, profitLevel: sig.tp }) });
    const data = await res.json();
    if (data.dealReference || data.dealId) {
      setTimeout(async () => {
        const syncRes = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
        const syncData = await syncRes.json();
        if (syncData.positions) {
          const matchingPos = syncData.positions.find(p => (p.market.epic === sig.asset || (p.market.epic === 'GOLD' && sig.asset === 'XAUUSD')) && p.position.direction === sig.direction);
          if (matchingPos) {
            await supabaseClient.from('signals').update({ deal_id: matchingPos.position.dealId }).eq('id', sig.id);
          }
        }
        syncLiveTrades();
      }, 2000);
    }
  } catch (err) { alert("Execution failed: " + err.message); }
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
      await supabaseClient.from('signals').update({ result: finalResult, deal_id: null }).eq('id', signalId);
      syncLiveTrades(); fetchSignals();
    }
  } catch (err) { alert("Close failed: " + err.message); }
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
  if (modal.style.display === 'flex') { modal.style.display = 'none'; return; }
  document.getElementById('signal-form').reset();
  // Force reset to BUY on open
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
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  fetchSignals();
  syncLiveTrades();
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => { fetchSignals(); syncLiveTrades(); }, 60000);

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
}

// --- FILTER LOGIC ---
let currentFilter = 'all';

function applyFilter(filter) {
  currentFilter = filter;
  
  // Update chip styles
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

  // Filter the cards visually
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    const statusClass = card.className;
    if (filter === 'all') card.style.display = '';
    else if (filter === 'open' && statusClass.includes('open')) card.style.display = '';
    else if (filter === 'pending' && statusClass.includes('pending')) card.style.display = '';
    else if (filter === 'closed' && statusClass.includes('closed')) card.style.display = '';
    else card.style.display = 'none';
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
