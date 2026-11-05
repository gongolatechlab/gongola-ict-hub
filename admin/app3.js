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
    if (list && list.innerHTML.includes('DB Error')) list.innerHTML = ''; // Clear old errors
  } catch (err) {
    // Only show the error if the list is empty (first load failure)
    if (list && list.innerHTML.trim() === '' && list.innerHTML.includes('DB Error') === false) {
      list.innerHTML = '<div class="text-center text-loss p-4">DB Error: ' + err.message + '</div>';
    }
    // If data already loaded, silently ignore (background sync failure)
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
      const risk = Math.abs(entryN - slN);
      const reward = Math.abs(tpN - entryN);
      if (risk > 0) rrDisplay = '1 → ' + (reward / risk).toFixed(1);
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
        <div class="facts">
          <div class="fact"><label>Entry</label><b class="num">${s.entry}</b></div>
          <div class="fact"><label>Risk→Reward</label><b class="num">${rrDisplay}</b></div>
          <div class="fact"><label>Size</label><b class="num">1×</b></div>
        </div>
        
        <div class="bar-wrap">
          <!-- Bar top removed, using price-track labels instead -->
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

        <!-- Chart & Analysis Tabs -->
        <div style="display:flex; margin-bottom:12px; border-bottom:1px solid var(--line); margin-top:16px;">
          <button onclick="event.stopPropagation(); switchTab('${s.id}', 'chart')" id="tab-chart-${s.id}" style="flex:1; padding:10px; background:none; border:none; color:var(--amber); font-weight:bold; border-bottom:2px solid var(--amber);">Chart</button>
          <button onclick="event.stopPropagation(); switchTab('${s.id}', 'analysis')" id="tab-analysis-${s.id}" style="flex:1; padding:10px; background:none; border:none; color:var(--muted); font-weight:bold; border-bottom:2px solid transparent;">Analysis</button>
        </div>
        <div id="content-chart-${s.id}" style="display:block;">
          <img src="${s.image_url || ''}" style="width:100%; border-radius:12px; border:1px solid var(--line);" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\'text-align:center;padding:20px;color:var(--muted);\'>No chart available</div>';">
        </div>
        <div id="content-analysis-${s.id}" style="display:none; padding:12px; background:var(--bg2); border:1px solid var(--line); border-radius:12px; font-size:14px; color:#cfd9e4; line-height:1.5;">
          ${s.analysis || 'No analysis provided.'}
        </div>

        <div class="actions">
          ${isLive ? `
            <button class="act danger" onclick="event.stopPropagation(); closeTrade('${s.id}', '${live.position.dealId}')">Close</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Scale Out coming soon!')">Scale Out</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Share coming soon!')">Share</button>
          ` : isClosed ? `
            <button class="act ghost" style="grid-column: span 3;">Closed (${s.result.toUpperCase()})</button>
          ` : `
            <button class="act danger" style="background:var(--green); color:#000; border-color:var(--green);" onclick="event.stopPropagation(); executeTrade('${s.id}')">Execute</button>
            <button class="act ghost" style="color:var(--red); border-color:rgba(255,90,79,.3);" onclick="event.stopPropagation(); deleteSignal('${s.id}')">Delete</button>
            <button class="act ghost" onclick="event.stopPropagation(); alert('Coming soon')">Send to channel</button>
          `}
        </div>
      </div>
    </article>`;
  }).join('') || '<div class="empty"><b>Nothing here yet</b>Tap “Post Signal” to add a trade.</div>';
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
  
  if (modal.style.display === 'flex') {
    modal.style.display = 'none';
    return;
  }

  document.getElementById('signal-form').reset();
  setSigDir('BUY');
  document.getElementById('sig-image-preview-container').style.display = 'none';
  document.getElementById('manual-fields').style.display = 'none';
  modal.style.display = 'flex';
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


// Bind the Total P/L card to open account info
document.addEventListener('DOMContentLoaded', () => {
  const plCard = document.querySelector('.stat.main');
  if (plCard) {
    plCard.style.cursor = 'pointer';
    plCard.onclick = openAccountInfo;
  }
});

// --- ACCOUNT INFO ---
async function openAccountInfo() {
  const loadingMsg = document.createElement('div');
  loadingMsg.id = 'acc-loading';
  loadingMsg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#141b24;border:1px solid #243040;color:#fff;padding:15px 25px;border-radius:12px;z-index:99999;font-weight:bold;';
  loadingMsg.innerText = 'Fetching Account Info...';
  document.body.appendChild(loadingMsg);

  try {
    const res = await fetch(EXECUTE_ENDPOINT, { 
      method: 'POST', 
      headers: { 'Content-Type': 'text/plain' }, 
      body: JSON.stringify({ action: 'get_account' }) 
    });
    const data = await res.json();
    loadingMsg.remove();

    if (data.accounts && data.accounts.length > 0) {
      const acc = data.accounts[0];
      const bal = acc.balance;
      
      let modal = document.getElementById('account-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'account-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        document.body.appendChild(modal);
      }
      
      modal.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;width:100%;max-width:400px;color:#fff;font-family:var(--sans);">
          <h2 style="font-size:20px;margin-bottom:20px;">Account Info</h2>
          
          <div style="background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:15px;margin-bottom:10px;">
            <p style="font-size:12px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Balance</p>
            <p style="font-size:24px;font-weight:bold;font-family:var(--mono);">$${parseFloat(bal.balance).toFixed(2)}</p>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:12px;">
              <p style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Available</p>
              <p style="font-size:16px;font-weight:bold;font-family:var(--mono);">$${parseFloat(bal.available).toFixed(2)}</p>
            </div>
            <div style="background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:12px;">
              <p style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Profit / Loss</p>
              <p style="font-size:16px;font-weight:bold;font-family:var(--mono);color:${parseFloat(bal.profitLoss) >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${parseFloat(bal.profitLoss) >= 0 ? '+' : ''}$${parseFloat(bal.profitLoss).toFixed(2)}
              </p>
            </div>
          </div>

          <div style="margin-top:20px;">
            <button onclick="document.getElementById('account-modal').remove()" style="width:100%;padding:14px;background:var(--card2);border:1px solid var(--line);border-radius:12px;color:#fff;font-weight:bold;font-size:16px;">Close</button>
          </div>
        </div>
      `;
    } else {
      alert("No account data received. " + JSON.stringify(data));
    }
  } catch (err) {
    if (loadingMsg) loadingMsg.remove();
    alert("Failed to fetch account info: " + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const plCard = document.querySelector('.stat.main');
  if (plCard) {
    plCard.style.cursor = 'pointer';
    plCard.onclick = openAccountInfo;
  }
});

// Tab switching logic
function switchTab(id, tab) {
  const chartBtn = document.getElementById('tab-chart-' + id);
  const analysisBtn = document.getElementById('tab-analysis-' + id);
  const chartContent = document.getElementById('content-chart-' + id);
  const analysisContent = document.getElementById('content-analysis-' + id);
  
  if (!chartBtn) return;

  if (tab === 'chart') {
    chartBtn.style.color = 'var(--amber)';
    chartBtn.style.borderBottom = '2px solid var(--amber)';
    analysisBtn.style.color = 'var(--muted)';
    analysisBtn.style.borderBottom = '2px solid transparent';
    chartContent.style.display = 'block';
    analysisContent.style.display = 'none';
  } else {
    analysisBtn.style.color = 'var(--amber)';
    analysisBtn.style.borderBottom = '2px solid var(--amber)';
    chartBtn.style.color = 'var(--muted)';
    chartBtn.style.borderBottom = '2px solid transparent';
    chartContent.style.display = 'none';
    analysisContent.style.display = 'block';
  }
}

function toggleExtraContent(id) {
  const el = document.getElementById('extra-content-' + id);
  if (el) {
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
  }
}
