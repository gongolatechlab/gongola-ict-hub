# Gongola ICT Hub - Dev Notes

## Architecture
- Frontend: HTML (index.html), CSS (inline in index.html), Vanilla JS (app3.js).
- Backend: Google Apps Script (AI Analysis & Capital.com execution).
- Database: Supabase (`signals` table, `charts` bucket).

## Known Fixes
1. **Direction Bug (Mirroring):** Fixed by ensuring `setSigDir()` updates the hidden `sig-direction` input, and the submit handler reads directly from that input.
2. **Duplicate Submission:** Fixed by using `onsubmit` directly on the form instead of adding multiple `DOMContentLoaded` listeners.
3. **Live Trade Matching:** Relaxed price matching tolerance to 5.0 points to accommodate Capital.com slippage.
4. **Filters:** Filters now check the actual CSS classes (`open`, `pending`, `closed`) on the cards.
5. **Tabs:** Chart/Analysis tabs are collapsible and toggle on click.
6. **Account Info:** Tapping the Total P/L card opens a modal showing Capital.com balance.
