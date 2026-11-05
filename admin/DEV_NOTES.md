# Gongola ICT Hub - Dev Notes

## TODO For Next Session
1. Fix Closed P/L Bug: `close_position` needs to return actual P/L to Supabase, not hardcode -100/+100.
2. Fix GitHub Push: Merge `fix-ui-update` into `main` when GitHub servers recover.
3. Build Public Signals Page.

## Completed Features
- 2-Card Top Layout (Balance + Win Rate)
- Premium SVG icons on all cards, tabs, and buttons
- Tight header padding (5px top / 2px bottom)
- Custom Alert Modal (replaced browser alerts)
- Scale Out Modal (25/50/75/Close All) with correct PUT /positions logic
- Trade Execution Lot Size prompt
- AI Analysis mapped to Custom Indicator Legend (OB, FVG, DOL, Killzones)
