window.toggleCardDetails = function(id) {
  const el = document.getElementById("card-details-" + id);
  if (el) el.classList.toggle("hidden");
};

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
  document.getElementById("universal-error-text").textContent += msg + " | ";
}

window.onerror = function(msg, url, line) { showUniversalError("JS ERROR: " + msg + " | Line: " + line + " | File: " + url); };
window.addEventListener('unhandledrejection', function(e) { showUniversalError("PROMISE: " + (e.reason ? e.reason.message || e.reason : "Unknown")); });


// --- FETCH SIGNALS ---
async function fetchSignals() {
  const list = document.getElementById('signal-list');
  if (!supabaseClient) {
    if (list) list.innerHTML = '<div class="text-center text-loss p-4">Database not ready.</div>';
    return;
  }
  try {
    const { data, error } = await supabaseClient.from('signals').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    signalsData = data || [];
    renderSignals();
  } catch (err) {
    if (list) list.innerHTML = '<div class="text-center text-loss p-4">DB Error: ' + err.message + '</div>';
  }
}

// --- SYNC LIVE TRADES ---
async function syncLiveTrades() {
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
    const data = await res.json();
    if (data.positions) {
      liveTrades = data.positions;
      updateLiveStrip();
      renderSignals();
    }
  } catch (err) { 
    console.error("Sync failed: " + err.message); 
  }
}

function updateLiveStrip() {
  let totalPnl = 0;
  liveTrades.forEach(p => { totalPnl += parseFloat(p.position.upl); });
  const strip = document.getElementById('strip-pnl');
  if (strip) {
    strip.innerText = (totalPnl > 0 ? '+$' : '$') + totalPnl.toFixed(2);
    strip.className = `text-lg font-mono font-bold ${totalPnl > 0 ? 'text-win' : totalPnl < 0 ? 'text-loss' : 'text-muted'}`;
  }
  const openEl = document.getElementById('strip-open');
  if (openEl) openEl.innerText = liveTrades.length;
  const timeEl = document.getElementById('strip-time');
  if (timeEl) timeEl.innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
  if (signalsData.length === 0) return list.innerHTML = '<div class="text-center text-muted text-sm p-8">No signals found.</div>';

  const usedDealIds = new Set();
  list.innerHTML = signalsData.map(s => {
    const live = getLiveTradeForSignal(s, usedDealIds);
    if (live && live.position && live.position.dealId) usedDealIds.add(live.position.dealId);
    const isLive = !!live;
    const livePnl = isLive ? parseFloat(live.position.upl) : 0;

    let statusBadge = '';
    if (isLive) {
      statusBadge = `<span class="sig-badge bg-open/20 text-open border border-open/50 flex items-center gap-1"><div class="w-1.5 h-1.5 rounded-full bg-open animate-pulse"></div> OPEN</span>`;
    } else if (s.result === 'win') {
      statusBadge = `<span class="sig-badge bg-win/20 text-win border border-win/50">WIN</span>`;
    } else if (s.result === 'loss') {
      statusBadge = `<span class="sig-badge bg-loss/20 text-loss border border-loss/50">LOSS</span>`;
    } else {
      statusBadge = `<span class="sig-badge bg-surface2 text-muted border border-line">PENDING</span>`;
    }

    const slN = parseFloat(s.sl), entryN = parseFloat(s.entry), tpN = parseFloat(s.tp);
    let rrDisplay = '—';
    if (Number.isFinite(slN) && Number.isFinite(entryN) && Number.isFinite(tpN)) {
      const risk = Math.abs(entryN - slN);
      const reward = Math.abs(tpN - entryN);
      if (risk > 0) rrDisplay = '1:' + (reward / risk).toFixed(1);
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

    return `
    <div class="sig-card flex flex-col bg-surface border border-line rounded-xl overflow-hidden mb-3">
      <!-- Collapsible Header -->
      <div class="flex justify-between items-center p-4 cursor-pointer hover:bg-surface2/50 transition-colors" onclick="document.getElementById('card-body-${s.id}').classList.toggle('hidden')">
        <div class="flex items-center gap-3">
          <span class="text-xl font-bold font-mono text-white">${s.asset}</span>
          <span class="sig-badge ${s.direction.toLowerCase()}">${s.direction}</span>
          <span class="text-xs text-muted font-mono">${new Date(s.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="flex items-center gap-3">
          ${isLive ? `<span class="text-sm font-mono font-bold ${livePnl >= 0 ? 'text-win' : 'text-loss'}">${livePnl > 0 ? '+' : ''}$${livePnl.toFixed(2)}</span>` : ''}
          ${statusBadge}
          <span class="text-sm font-mono text-muted font-bold">RR ${rrDisplay}</span>
          <svg class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>

      <!-- Collapsible Body -->
      <div id="card-body-${s.id}" class="hidden">
        
        <!-- Price Bar -->
        <div class="px-4 pt-4 pb-2 border-t border-line">
          <div class="price-track">
            <div class="zone-sl" style="width: ${leftPin}%;"></div>
            <div class="zone-tp" style="width: ${100 - rightPin}%; margin-left: ${rightPin}%;"></div>
            <div class="pin" style="left: ${pctSL}%;"><span class="pin-label">SL</span></div>
            <div class="pin entry" style="left: ${pctEntry}%;"><span class="pin-label">ENTRY</span></div>
            <div class="pin" style="left: ${pctTP}%;"><span class="pin-label">TP</span></div>
            ${pctLive !== null ? `<div class="pin live" style="left: ${pctLive}%;"><span class="pin-label" style="color:#00E5FF; top:10px;">LIVE</span></div>` : ''}
          </div>
          <div class="flex justify-between text-xs font-mono text-muted mt-2">
            <span>${s.sl}</span>
            <span>${s.entry}</span>
            <span>${s.tp}</span>
          </div>
        </div>

        <!-- Chart & Analysis Grid -->
        <div class="grid grid-cols-2 border-t border-line">
          <div onclick="openImage('${s.image_url}')" class="p-4 bg-surface2/30 border-r border-line flex flex-col items-center justify-center cursor-pointer hover:bg-surface2/60 transition-colors h-32">
            <svg class="w-6 h-6 text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            <span class="text-sm font-bold text-muted">Chart</span>
          </div>
          <div onclick="openAnalysis('${s.id}')" class="p-4 bg-surface2/30 flex flex-col items-center justify-center cursor-pointer hover:bg-surface2/60 transition-colors h-32">
            <svg class="w-6 h-6 text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <span class="text-sm font-bold text-muted">Analysis</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="p-3 border-t border-line flex gap-2 bg-surface">
          ${isLive ? `
            <button onclick="closeTrade('${s.id}','${live.position.dealId}')" class="flex-1 py-3 bg-loss text-white font-bold rounded-lg hover:brightness-110">Close</button>
            <button onclick="alert('Scale Out feature coming soon!')" class="flex-1 py-3 bg-[#0B0C10] text-white font-bold rounded-lg border border-line hover:border-accent">Scale Out</button>
            <button onclick="alert('Share feature coming soon!')" class="flex-1 py-3 bg-[#0B0C10] text-white font-bold rounded-lg border border-line hover:border-accent">Share</button>
          ` : s.result === 'win' || s.result === 'loss' ? `
            <button class="flex-1 py-3 bg-surface2 text-muted border border-line rounded-lg font-bold cursor-not-allowed" disabled>Closed</button>
          ` : `
            <button onclick="executeTrade('${s.id}')" class="flex-1 py-3 bg-win text-bg font-bold rounded-lg hover:brightness-110">Execute</button>
            <button onclick="alert('Scale Out only available for live trades.')" class="flex-1 py-3 bg-[#0B0C10] text-white font-bold rounded-lg border border-line hover:border-accent">Scale Out</button>
            <button onclick="alert('Share feature coming soon!')" class="flex-1 py-3 bg-[#0B0C10] text-white font-bold rounded-lg border border-line hover:border-accent">Share</button>
          `}
        </div>
      </div>
    </div>`;
  }).join('');
}
async function executeTrade(id) {
  const sig = signalsData.find(s => s.id === id);
  if (!sig) return;
  if (!confirm(`Execute ${sig.direction} ${sig.asset}?`)) return;
  showAlert("Sending order...", "success");
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'execute_trade', epic: sig.asset === 'XAUUSD' ? 'GOLD' : sig.asset, direction: sig.direction, size: 1.0, stopLevel: sig.sl, profitLevel: sig.tp }) });
    const data = await res.json();
    if (data.dealReference || data.dealId) {
      showAlert("Trade Executed! Syncing...", "success");
      setTimeout(async () => {
        const syncRes = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
        const syncData = await syncRes.json();
        if (syncData.positions) {
          const matchingPos = syncData.positions.find(p => (p.market.epic === sig.asset || (p.market.epic === 'GOLD' && sig.asset === 'XAUUSD')) && p.position.direction === sig.direction);
          if (matchingPos) {
            await supabaseClient.from('signals').update({ deal_id: matchingPos.position.dealId }).eq('id', sig.id);
            showAlert("Linked Deal ID!", "success");
          }
        }
        syncLiveTrades();
      }, 2000);
    } else { showAlert("Execution Failed: " + JSON.stringify(data), "error"); }
  } catch (err) { showUniversalError("Execution failed: " + err.message); }
}

async function closeTrade(signalId, dealId) {
  if (!dealId) return showAlert("No deal ID.", "error");
  if (!confirm('Close position on Capital.com?')) return;
  const live = liveTrades.find(p => p.position.dealId === dealId);
  const pnl = live ? parseFloat(live.position.upl) : 0;
  const finalResult = pnl >= 0 ? 'win' : 'loss';
  showAlert("Closing...", "success");
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'close_position', dealId: dealId }) });
    const data = await res.json();
    if (data.success || data.dealReference || data.dealId) {
      await supabaseClient.from('signals').update({ result: finalResult, deal_id: null }).eq('id', signalId);
      showAlert("Closed & marked " + finalResult.toUpperCase(), "success");
      syncLiveTrades(); fetchSignals();
    } else { showAlert("Close failed.", "error"); }
  } catch (err) { showUniversalError("Close failed: " + err.message); }
}

async function updateResult(id, result) {
  await supabaseClient.from('signals').update({ result }).eq('id', id);
  fetchSignals();
}

async function deleteSignal(id) {
  if (confirm('Delete permanently?')) {
    await supabaseClient.from('signals').delete().eq('id', id);
    fetchSignals();
  }
}

function showAlert(message, type = 'error') {
  const modal = document.getElementById('custom-alert');
  if(!modal) return alert(message);
  const title = document.getElementById('alert-title');
  const msg = document.getElementById('alert-message');
  if(title) title.innerText = type === 'error' ? 'Error' : 'Success';
  if(msg) msg.innerText = message;
  
  if (typeof modal.showModal === "function") { 
    try { modal.showModal(); } catch(e) { modal.style.display = "block"; } 
  } else { 
    modal.style.display = "block"; 
  }
}

function hideAlert() { 
  const modal = document.getElementById('custom-alert'); 
  if (modal) { 
    if (typeof modal.close === "function") { modal.close(); } 
    else { modal.style.display = "none"; modal.removeAttribute("open"); } 
  } 
}

function toggleSignalModal() {
  const modal = document.getElementById('signal-modal');
  if (!modal) return;
  
  const isOpen = modal.hasAttribute('open') || modal.style.display === 'block';
  
  if (isOpen) {
    if (typeof modal.close === 'function') modal.close();
    modal.removeAttribute('open');
    modal.style.display = 'none';
    return;
  }

  document.getElementById('signal-form').reset();
  setSigDir('BUY');
  document.getElementById('sig-image-preview-container').classList.add('hidden');
  document.getElementById('manual-fields').classList.add('hidden');
  
  if (typeof modal.showModal === 'function') {
    try { modal.showModal(); } catch(e) { modal.style.display = 'block'; modal.setAttribute('open', ''); }
  } else {
    modal.style.display = 'block';
    modal.setAttribute('open', '');
  }
}

function setSigDir(dir) {
  currentSigDir = dir; document.getElementById('sig-direction').value = dir;
  const b = document.getElementById('sig-btn-buy'), s = document.getElementById('sig-btn-sell');
  if (dir === 'BUY') { 
    b.className = 'flex-1 py-2.5 rounded-lg border border-win bg-win/10 text-win font-bold text-sm transition-all flex justify-center items-center gap-2'; 
    s.className = 'flex-1 py-2.5 rounded-lg border border-transparent text-muted font-bold text-sm transition-all flex justify-center items-center gap-2'; 
  } else { 
    s.className = 'flex-1 py-2.5 rounded-lg border border-loss bg-loss/10 text-loss font-bold text-sm transition-all flex justify-center items-center gap-2'; 
    b.className = 'flex-1 py-2.5 rounded-lg border border-transparent text-muted font-bold text-sm transition-all flex justify-center items-center gap-2'; 
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('sig-image-input');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = function(event) {
        const img = new Image();
        img.onload = async function() {
          const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = img.height * (800 / img.width);
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64Data = canvas.toDataURL('image/jpeg', 0.7);
          document.getElementById('sig-image-preview').src = base64Data; document.getElementById('sig-image-preview-container').classList.remove('hidden');
          document.getElementById('sig-image-loading').classList.remove('hidden'); document.getElementById('sig-image-loading').classList.add('flex');
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
          finally { notesArea.disabled = false; document.getElementById('manual-fields').classList.remove('hidden'); document.getElementById('sig-image-loading').classList.add('hidden'); document.getElementById('sig-image-loading').classList.remove('flex'); }
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const form = document.getElementById('signal-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn'); btn.innerText = "Publishing..."; btn.disabled = true;
      const asset = document.getElementById('sig-asset').value.toUpperCase().trim(); const cat = document.getElementById('sig-cat').value;
      const entry = document.getElementById('sig-entry').value; const sl = document.getElementById('sig-sl').value; const tp = document.getElementById('sig-tp').value;
      const analysis = document.getElementById('sig-notes').value.trim(); const fileInput = document.getElementById('sig-image-input');
      let imageUrl = null;
      try {
        if (fileInput.files.length > 0) {
          const file = fileInput.files[0]; const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
          const { error: uploadError } = await supabaseClient.storage.from('charts').upload(fileName, file);
          if (uploadError) throw uploadError;
          const { data: publicUrlData } = supabaseClient.storage.from('charts').getPublicUrl(fileName); imageUrl = publicUrlData.publicUrl;
        }
        const { error: insertError } = await supabaseClient.from('signals').insert([{ asset, category: cat, direction: currentSigDir, entry, sl, tp, analysis, image_url: imageUrl, result: 'pending' }]);
        if (insertError) throw insertError;
        showAlert("Signal published successfully!", "success"); toggleSignalModal(); fetchSignals();
      } catch (err) { showAlert("Failed to post signal: " + err.message, "error"); }
      finally { btn.innerText = "Publish Signal"; btn.disabled = false; }
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (!window.supabase) {
    showUniversalError("Supabase library not loaded. Check internet.");
    return;
  }
  
  // Initialize Supabase
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // Load data immediately
  fetchSignals();
  syncLiveTrades();
  
  // Auto-sync every 60 seconds
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    syncLiveTrades();
    fetchSignals();
  }, 60000);
});

function openImage(url) {
  if (!url) return alert("No image available for this signal.");
  let modal = document.getElementById('image-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'image-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = '<img id="image-modal-img" style="max-width:100%;max-height:100%;border-radius:8px;"><button onclick="document.getElementById(\'image-modal\').remove()" style="position:absolute;top:20px;right:20px;background:red;color:white;border:none;padding:10px 15px;border-radius:5px;font-weight:bold;">✕ Close</button>';
    document.body.appendChild(modal);
  }
  document.getElementById('image-modal-img').src = url;
}

function openAnalysis(id) {
  const sig = signalsData.find(s => s.id === id);
  if (!sig || !sig.analysis) return alert("No analysis available.");
  alert(sig.analysis.replace(/\*/g, ''));
}
