# Gongola ICT Hub - Dev Notes

## Debugging History & Solutions
1. **Double Body Tags:** Caused blank white screens. Fixed by ensuring only one `<body>` tag exists.
2. **Unclosed Script Tags:** Caused raw JS text to render on screen. Fixed by ensuring `<script>` and `</script>` counts match.
3. **Duplicate Pin Logic:** Caused SyntaxErrors that blocked the Unlock button. Fixed by isolating the `checkPin()` logic.
4. **Service Worker Cache:** Kept serving broken HTML. Fixed by temporarily disabling/renaming `sw.js` or using Incognito mode.
5. **Live Trade Matching:** Fixed by strictly matching via `deal_id` and checking Entry/SL/TP prices to prevent phantom trades.
6. **Live Bar Clamping:** Fixed the cyan live pin by calculating the range strictly from Entry/SL/TP and clamping to 0-100%.

## Architecture
- **Frontend:** Vanilla JS (`app.js`), HTML (`index.html`), CSS (`style.css`).
- **Backend:** Google Apps Script (AI Analysis & Capital.com execution).
- **Database:** Supabase (`signals` table, `charts` bucket).

