const SUPABASE_URL = 'https://usayycqwgdyklfzrinvc.supabase.co';
  const SUPABASE_KEY = 'YOUR_PUBLISHABLE_KEY_HERE';
  const AI_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";
  const EXECUTE_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjI8nb-XFZEOBRrefmIPolUb2Y_gc_a5ESmOxDATJWqwx0dvHcILWONt7TtiFa-DKmXg/exec";

  let supabaseClient = null;
  let signalsData = [];
  let liveTrades = [];
  let currentSigDir = 'BUY';

  function checkPin() {
    if (document.getElementById('admin-pin').value === "1973") {
      const gate = document.getElementById('pin-gate');
      if (gate) gate.style.display = 'none';
      const main = document.getElementById('main-content');
      if (main) main.classList.remove('hidden');
      try {
        if (window.supabase) {
          supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
          fetchSignals();
          setInterval(syncLiveTrades, 30000);
        }
      } catch (err) {
        console.error('Supabase failed', err);
      }
    } else {
      alert('Incorrect PIN');
    }
  }
  

  function showAlert(message, type = 'error') {
    const modal = document.getElementById('custom-alert'); const box = document.getElementById('alert-box'); const iconDiv = document.getElementById('alert-icon'); const iconSvg = document.getElementById('alert-svg'); const title = document.getElementById('alert-title');
    document.getElementById('alert-message').innerText = message;
    if (type === 'error') { iconDiv.className = 'mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center bg-loss/20 text-loss'; iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>'; title.innerText = "Error"; }
    else { iconDiv.className = 'mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center bg-win/20 text-win'; iconSvg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>'; title.innerText = "Success"; }
    modal.classList.remove('hidden'); modal.classList.add('flex'); setTimeout(() => box.classList.remove('scale-95'), 10);
  }
  function hideAlert() { const modal = document.getElementById('custom-alert'); const box = document.getElementById('alert-box'); box.classList.add('scale-95'); setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 200); }

  async function fetchSignals() {
    const { data, error } = await supabaseClient.from('signals').select('*').order('created_at', { ascending: false });
    if (error) return document.getElementById('signal-list').innerHTML = '<div class="text-center text-loss">Failed to load signals.</div>';
    signalsData = data; 
    renderSignals();
  }

  async function syncLiveTrades() {
    const btn = document.getElementById('sync-btn');
    if(btn) btn.innerHTML = '<div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>';
    try {
      const res = await fetch(EXECUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync_positions' }) });
      const data = await res.json();
      if (data.positions) {
        liveTrades = data.positions;
        updateLiveStrip();
        renderSignals(); // Re-render with new live data
      }
    } catch (err) { console.error("Sync failed", err); }
    finally { if(btn) btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'; }
  }

  function updateLiveStrip() {
    let totalPnl = 0;
    liveTrades.forEach(p => { totalPnl += parseFloat(p.position.upl); });
    const strip = document.getElementById('strip-pnl');
    strip.innerText = (totalPnl > 0 ? '+$' : '$') + totalPnl.toFixed(2);
    strip.className = `text-lg font-mono font-bold ${totalPnl > 0 ? 'text-win' : totalPnl < 0 ? 'text-loss' : 'text-muted'}`;
    document.getElementById('strip-open').innerText = liveTrades.length;
    document.getElementById('strip-time').innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  }

  function getLiveTradeForSignal(s, used) {
    used = used || new Set();
    // 1. Strict deal_id match
    if (s.deal_id) {
      const m = liveTrades.find(p => (p.position.dealId === s.deal_id || p.position.workingOrderId === s.deal_id) && !used.has(p.position.dealId));
      if (m) return m;
    }
    // 2. Strict Price Matching (Entry & SL & TP must align closely)
    const getNum = (val) => parseFloat(String(val).replace(/[^0-9.-]+/g,""));
    const sEntry = getNum(s.entry), sSL = getNum(s.sl), sTP = getNum(s.tp);
    
    return liveTrades.find(p => {
      if (used.has(p.position.dealId)) return false;
      const epicMatch = (p.market.epic === s.asset || (p.market.epic === 'GOLD' && s.asset === 'XAUUSD'));
      if (!epicMatch || p.position.direction !== s.direction) return false;
      
      // If the database has saved prices, ensure they match the live trade's levels
      const pLevel = p.position.level || p.position.openLevel;
      if (!pLevel || !sEntry) return false;
      
      const pSL = p.position.stopLevel;
      const pTP = p.position.profitLevel;
      
      const priceMatch = Math.abs(pLevel - sEntry) < 0.5;
      const slMatch = !pSL || !sSL || Math.abs(pSL - sSL) < 0.5;
      const tpMatch = !pTP || !sTP || Math.abs(pTP - sTP) < 0.5;
      
      return priceMatch && slMatch && tpMatch;
    });
  }

  function renderSignals() {
    const list = document.getElementById('signal-list');
    if (signalsData.length === 0) return list.innerHTML = '<div class="text-center text-muted text-sm p-8">No signals found.</div>';
    
    const usedDealIds = new Set();
    list.innerHTML = signalsData.map(s => {
      const live = getLiveTradeForSignal(s, usedDealIds);
      if (live && live.position && live.position.dealId) usedDealIds.add(live.position.dealId);
      const isLive = !!live;
      const livePnl = isLive ? parseFloat(live.position.upl) : 0;
      
      let statusBadge = '';
      let resultColor = 'bg-surface2 text-muted border-line';
      
      if (isLive) {
        statusBadge = `<span class="sig-badge bg-open/20 text-open border border-open/50 flex items-center gap-1"><div class="w-1.5 h-1.5 rounded-full bg-open animate-pulse"></div> OPEN</span>`;
        resultColor = 'bg-open/20 text-open border-open/50';
      } else if (s.result === 'win') {
        statusBadge = `<span class="sig-badge bg-win/20 text-win border border-win/50">WIN</span>`;
        resultColor = 'bg-win/20 text-win border-win/50';
      } else if (s.result === 'loss') {
        statusBadge = `<span class="sig-badge bg-loss/20 text-loss border border-loss/50">LOSS</span>`;
        resultColor = 'bg-loss/20 text-loss border-loss/50';
      } else {
        statusBadge = `<span class="sig-badge bg-surface2 text-muted border border-line">PENDING</span>`;
      }

      // Price Bar calculations (fixed range from entry/SL/TP; live pin clamped)
      const slN = parseFloat(s.sl), entryN = parseFloat(s.entry), tpN = parseFloat(s.tp);
      const fixedPrices = [slN, entryN, tpN].filter(Number.isFinite);
      const min = Math.min(...fixedPrices);
      const max = Math.max(...fixedPrices);
      const range = (max - min) || 1;
      const pctSL = ((slN - min) / range) * 100;
      const pctEntry = ((entryN - min) / range) * 100;
      const pctTP = ((tpN - min) / range) * 100;
      const liveBid = live ? parseFloat(live.market.bid) : null;
      let pctLive = (liveBid !== null && Number.isFinite(liveBid)) ? ((liveBid - min) / range) * 100 : null;
      if (pctLive !== null) pctLive = Math.max(0, Math.min(100, pctLive));

      const leftPin = Math.min(pctSL, pctTP);
      const rightPin = Math.max(pctSL, pctTP);

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
          <!-- Visual Price Bar -->
          <div class="px-4 mt-2">
            <div class="price-track">
              <div class="zone-sl" style="width: ${leftPin}%;"></div>
              <div class="zone-tp" style="width: ${100 - rightPin}%; margin-left: ${rightPin}%;"></div>

              <div class="pin" style="left: ${pctSL}%;"><span class="pin-label">SL</span></div>
              <div class="pin entry" style="left: ${pctEntry}%;"><span class="pin-label">ENTRY</span></div>
              <div class="pin" style="left: ${pctTP}%;"><span class="pin-label">TP</span></div>

              ${pctLive !== null ? `<div class="pin live" style="left: ${pctLive}%;"><span class="pin-label" style="color:#00E5FF; top:10px;">LIVE</span></div>` : ''}
            </div>
          </div>

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
      </div>`
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