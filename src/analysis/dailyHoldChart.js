import { Box, Typography } from '@mui/material';

// Daily candles of a swing holding: from the buy day (day 0) to the sell day (day 15) or the latest day.
const W = 1100;
const H = 300;
const PAD = { top: 26, right: 110, bottom: 34, left: 14 };

const shortDay = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const DailyHoldChart = ({ bars = [], entry, exit, holdDays = 15 }) => {
    if (bars.length < 2) {
        return <Typography sx={{ color: '#64748b', fontSize: 14 }}>The hold has only just started; no daily candles yet.</Typography>;
    }
    const levels = [entry, exit].filter((v) => Number.isFinite(Number(v)));
    const prices = [...bars.flatMap((b) => [b.high, b.low]), ...levels];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padPrice = (max - min || 1) * 0.08;
    const lo = min - padPrice;
    const hi = max + padPrice;
    const slots = holdDays + 1;
    const slotW = (W - PAD.left - PAD.right) / slots;
    const x = (i) => PAD.left + (i + 0.5) * slotW;
    const y = (p) => PAD.top + ((hi - p) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const bodyW = Math.min(26, slotW * 0.55);
    const last = bars[bars.length - 1];
    const pill = (level, text, color) => (
        <g>
            <rect x={W - PAD.right + 6} y={y(level) - 10} width={PAD.right - 12} height="20" rx="10" fill={color} />
            <text x={W - PAD.right + 6 + (PAD.right - 12) / 2} y={y(level) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
                {text}
            </text>
        </g>
    );

    return (
        <Box sx={{ width: '100%', overflowX: 'auto', borderRadius: 3, border: '1px solid rgba(15,23,42,0.08)', background: '#fff' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 760, height: 'auto', display: 'block' }} role="img" aria-label="Daily candles during the swing hold">
                <rect x={PAD.left} y={PAD.top - 8} width={x(holdDays) + slotW / 2 - PAD.left} height={H - PAD.top - PAD.bottom + 8} fill="#0f766e0d" />
                <line x1={PAD.left} x2={W - PAD.right} y1={y(entry)} y2={y(entry)} stroke="#2563eb" strokeWidth="1.6" strokeDasharray="6 4" />
                {pill(entry, `Buy ${Number(entry).toFixed(2)}`, '#2563eb')}
                {Number.isFinite(Number(exit)) ? (
                    <>
                        <line x1={x(bars.length - 1)} x2={W - PAD.right} y1={y(exit)} y2={y(exit)} stroke="#7c3aed" strokeWidth="2" />
                        {pill(exit, `Sell ${Number(exit).toFixed(2)}`, '#7c3aed')}
                    </>
                ) : (
                    pill(last.close, `Last ${last.close.toFixed(2)}`, '#64748b')
                )}
                {bars.map((b, i) => {
                    const color = b.close >= b.open ? '#16a34a' : '#dc2626';
                    return (
                        <g key={b.day}>
                            <title>{`${b.day} · O ${b.open.toFixed(2)} H ${b.high.toFixed(2)} L ${b.low.toFixed(2)} C ${b.close.toFixed(2)}`}</title>
                            <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth="1.6" />
                            <rect x={x(i) - bodyW / 2} y={y(Math.max(b.open, b.close))} width={bodyW} height={Math.max(1.5, Math.abs(y(b.open) - y(b.close)))} fill={color} rx="1.5" />
                            <text x={x(i)} y={H - 18} textAnchor="middle" fontSize="10.5" fill="#64748b">
                                {i === 0 ? 'buy' : `d${i}`}
                            </text>
                            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9.5" fill="#94a3b8">
                                {shortDay(b.day)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </Box>
    );
};

export default DailyHoldChart;
