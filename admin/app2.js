document.addEventListener("DOMContentLoaded", () => {
  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;background:red;color:white;text-align:center;padding:10px;font-weight:bold;z-index:99999;";
  banner.innerText = "✅ APP2.JS IS LOADED AND RUNNING";
  document.body.appendChild(banner);
});

const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzYXl5Y3F3Z2R5a2xmenJpbnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTg5NjYsImV4cCI6MjEwOTE5NDk2Nn0.jgEo3bvyKK_ak1yMRILX-32tCrg8BKSlzDvu-ccDq3w';
const AI_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";
const EXECUTE_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";

let supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let signalsData = [];
let liveTrades = [];
let currentSigDir = 'BUY';

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
  document.getElementById('universal-error-text').textContent += msg + "\n\n";
}

window.onerror = function(msg, url, line) { showUniversalError("JS ERROR: " + msg + "\nLine: " + line + "\nFile: " + url); };
window.addEventListener('unhandledrejection', function(e) { showUniversalError("PROMISE: " + (e.reason ? e.reason.message || e.reason : "Unknown")); });
const originalError = console.error;
console.error = function(...args) { originalError.apply(console, args); showUniversalError("CONSOLE: " + args.join(' ')); };

// --- LOGIN ---
function checkPin() {
  if (document.getElementById('admin-pin').value === "1973") {
    document.getElementById('pin-gate').style.display = 'none';
    document.getElementById('main-content').classList.remove('hidden');
    
    let attempts = 0;
    const initInterval = setInterval(() => {
      attempts++;
      if (window.supabase) {
        clearInterval(initInterval);
        try {
          supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
          fetchSignals();
          syncLiveTrades();
          setInterval(syncLiveTrades, 30000);
        } catch(err) { showUniversalError("Supabase init failed: " + err.message); }
      } else if (attempts > 40) {
        clearInterval(initInterval);
        showUniversalError("Supabase CDN failed to load after 10s. Check your internet.");
      }
    }, 250);
  } else {
    alert("Incorrect PIN");
  }
}

// --- FETCH SIGNALS ---
async function fetchSignals() {
  if (!supabaseClient) return showUniversalError("Supabase client is null");
  try {
    const { data, error } = await supabaseClient.from('signals').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    signalsData = data || [];
    renderSignals();
  } catch (err) {
    showUniversalError("DB Fetch Error: " + err.message);
  }
}

// --- SYNC LIVE TRADES ---
async function syncLiveTrades() {
  const btn = document.getElementById('sync-btn');
  if(btn) btn.innerHTML = '<div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>';
  try {
    const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
    const data = await res.json();
    if (data.positions) {
      liveTrades = data.positions;
      updateLiveStrip();
      renderSignals();
    }
  } catch (err) { 
    showUniversalError("Sync failed: " + err.message); 
  } finally { 
    if(btn) btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'; 
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

// --- RENDER LOGIC ---
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
    const fixedPrices = [slN, entryN, tpN].filter(Number.isFinite);
    const min = Math.min(...fixedPrices); const max = Math.max(...fixedPrices);
    const range = (max - min) || 1;
    const pctSL = ((slN - min) / range) * 100; const pctEntry = ((entryN - min) / range) * 100; const pctTP = ((tpN - min) / range) * 100;
    const liveBid = live ? parseFloat(live.market.bid) : null;
    let pctLive = (liveBid !== null && Number.isFinite(liveBid)) ? ((liveBid - min) / range) * 100 : null;
    if (pctLive !== null) pctLive = Math.max(0, Math.min(100, pctLive));
    const leftPin = Math.min(pctSL, pctTP); const rightPin = Math.max(pctSL, pctTP);

    let dynamicBtn = '';
    if (isLive) {
      const dId = (live.position && live.position.dealId) ? live.position.dealId : '';
      dynamicBtn = `<button onclick="closeTrade('${s.id}','${dId}')" class="flex-1 py-2 bg-loss text-bg rounded-lg text-xs font-bold">Close ${livePnl > 0 ? '+' : ''}$${livePnl.toFixed(2)}</button>`;
    } else if (s.result === 'win' || s.result === 'loss') {
      dynamicBtn = `<button class="flex-1 py-2 bg-surface2 text-muted border border-line rounded-lg text-xs font-bold" disabled>Closed</button>`;
    } else {
      dynamicBtn = `<button onclick="executeTrade('${s.id}')" class="flex-1 py-2 bg-win text-bg rounded-lg text-xs font-bold">Execute</button>`;
    }

    const livePnlBadge = isLive ? `<span class="text-[10px] font-mono font-bold px-2 py-1 rounded ${livePnl >= 0 ? 'text-win bg-win/10' : 'text-loss bg-loss/10'}">${livePnl > 0 ? '+' : ''}$${livePnl.toFixed(2)}</span>` : '';

    return `
    <div class="sig-card">
      <div class="p-4 flex justify-between items-center cursor-pointer hover:bg-surface2/50 transition-colors" onclick="document.getElementById('card-details-${s.id}').classList.toggle('hidden')">
        <div class="flex items-center gap-3">
          <span class="text-lg font-bold font-mono">${s.asset}</span>
          <span class="sig-badge ${s.direction.toLowerCase()}">${s.direction}</span>
          <span class="text-[10px] font-mono text-muted bg-bg px-1.5 py-0.5 rounded border border-line">RR ${s.rr || '—'}</span>
        </div>
        <div class="flex items-center gap-2">
          ${livePnlBadge}
          ${statusBadge}
          <svg class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <div id="card-details-${s.id}" class="hidden">
        <div class="px-4 mt-2"><div class="price-track">
          <div class="zone-sl" style="width: ${leftPin}%;"></div><div class="zone-tp" style="width: ${100 - rightPin}%; margin-left: ${rightPin}%;"></div>
          <div class="pin" style="left: ${pctSL}%;"><span class="pin-label">SL</span></div>
          <div class="pin entry" style="left: ${pctEntry}%;"><span class="pin-label">ENTRY</span></div>
          <div class="pin" style="left: ${pctTP}%;"><span class="pin-label">TP</span></div>
          ${pctLive !== null ? `<div class="pin live" style="left: ${pctLive}%;"><span class="pin-label" style="color:#00E5FF; top:10px;">LIVE</span></div>` : ''}
        </div></div>
        <div class="p-4">
          <div class="sig-grid">
            <div><div class="sig-label">Entry</div><div class="sig-val">${s.entry}</div></div>
            <div><div class="sig-label">SL</div><div class="sig-val text-loss">${s.sl}</div></div>
            <div><div class="sig-label">TP</div><div class="sig-val text-win">${s.tp}</div></div>
          </div>
          ${s.analysis ? `<div class="mt-4 pt-4 border-t border-line"><div class="sig-label mb-1">Analysis</div><div class="text-sm text-text/80 leading-relaxed">${s.analysis.replace(/\*/g, '')}</div></div>` : ''}
          ${s.image_url ? `<div class="mt-4"><img src="${s.image_url}" class="w-full rounded-lg border border-line object-contain max-h-64"></div>` : ''}
        </div>
        <div class="p-3 border-t border-line flex gap-2 bg-surface2 mt-2">
          ${dynamicBtn}
          <button onclick="updateResult('${s.id}', 'win')" class="flex-1 py-2 bg-bg border border-line rounded-lg text-xs font-bold text-muted hover:text-win hover:border-win">Win</button>
          <button onclick="updateResult('${s.id}', 'loss')" class="flex-1 py-2 bg-bg border border-line rounded-lg text-xs font-bold text-muted hover:text-loss hover:border-loss">Loss</button>
          <button onclick="deleteSignal('${s.id}')" class="px-3 py-2 bg-bg border border-line rounded-lg text-muted hover:text-loss hover:border-loss flex items-center justify-center"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
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
  modal.showModal();
}

function hideAlert() { document.getElementById('custom-alert')?.close(); }

function toggleSignalModal() {
  const modal = document.getElementById('signal-modal');
  if (!modal) return;
  if (modal.open) return modal.close();
  document.getElementById('signal-form').reset();
  setSigDir('BUY');
  document.getElementById('sig-image-preview-container').classList.add('hidden');
  document.getElementById('manual-fields').classList.add('hidden');
  modal.showModal();
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
      } catch (err) { showUniversalError("PUBLISH ERROR: " + err.message); }
      finally { btn.innerText = "Publish Signal"; btn.disabled = false; }
    });
  }
});
