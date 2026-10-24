import { useMemo, useState } from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

// Two-session 5-minute candlestick chart: the previous day and the signal day side by side, with the gap,
// the 1st-candle range and break window, entry/stop/exit levels, markers, volume and a hover tooltip.

const COLORS = {
    up: '#16a34a',
    down: '#dc2626',
    entry: '#2563eb',
    stop: '#dc2626',
    exit: '#7c3aed',
    prevClose: '#64748b',
    range: '#f59e0b',
    grid: '#eef2f7',
    axis: '#94a3b8',
    text: '#64748b',
    ink: '#0f172a',
};

const W = 1100;
const H = 540;
const PAD = { top: 52, right: 92, bottom: 34, left: 14 };
const VOLUME_HEIGHT = 70;
const PANE_GAP = 14;
const SEPARATOR_SLOTS = 4;

const istTime = (value) =>
    new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const istMinute = (value) => {
    const d = new Date(new Date(value).getTime() + 330 * 60000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const dayLabel = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmt = (n) => Number(n).toFixed(2);

// pushes overlapping axis labels apart (sorted by y)
const spreadLabels = (labels, minGap, top, bottom) => {
    const sorted = [...labels].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].y - sorted[i - 1].y < minGap) sorted[i].y = sorted[i - 1].y + minGap;
    }
    const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
    if (overflow > 0) sorted.forEach((l) => { l.y = Math.max(top, l.y - overflow); });
    return sorted;
};

const TwoDayChart = ({ prevDay, prevCandles = [], day, dayCandles = [], signal, breakCandles = 3 }) => {
    const [view, setView] = useState('both');
    const [hover, setHover] = useState(null);
    const showPrev = view === 'both' && prevCandles.length > 0;

    const layout = useMemo(() => {
        const slots = [];
        if (showPrev) prevCandles.forEach((c) => slots.push({ c, session: 'prev' }));
        const separatorStart = slots.length;
        if (showPrev) for (let i = 0; i < SEPARATOR_SLOTS; i += 1) slots.push(null);
        const dayStart = slots.length;
        dayCandles.forEach((c) => slots.push({ c, session: 'day' }));

        const plotWidth = W - PAD.left - PAD.right;
        const slotW = plotWidth / Math.max(slots.length, 1);
        const x = (i) => PAD.left + (i + 0.5) * slotW;

        const priceTop = PAD.top;
        const priceBottom = H - PAD.bottom - VOLUME_HEIGHT - PANE_GAP;
        const levels = [signal?.prevClose, signal?.entry, signal?.stop, signal?.exit ?? signal?.lastPrice].filter((v) => Number.isFinite(Number(v)));
        const candlesShown = slots.filter(Boolean).map((s) => s.c);
        const prices = [...candlesShown.flatMap((c) => [c.high, c.low]), ...levels].map(Number);
        let min = Math.min(...prices);
        let max = Math.max(...prices);
        const padPrice = (max - min || 1) * 0.06;
        min -= padPrice;
        max += padPrice;
        const y = (p) => priceTop + ((max - Number(p)) / (max - min)) * (priceBottom - priceTop);
        const maxVolume = Math.max(1, ...candlesShown.map((c) => c.volume || 0));

        const sameTime = (a, b) => a && b && new Date(a).getTime() === new Date(b).getTime();
        const entryIdx = slots.findIndex((s) => s && s.session === 'day' && sameTime(s.c.date, signal?.time));
        const exitIdx = signal?.closedAt
            ? slots.findIndex((s) => s && s.session === 'day' && sameTime(s.c.date, signal.closedAt))
            : slots.length - 1;

        return { slots, separatorStart, dayStart, slotW, x, y, priceTop, priceBottom, min, max, maxVolume, entryIdx, exitIdx };
    }, [showPrev, prevCandles, dayCandles, signal]);

    const { slots, separatorStart, dayStart, slotW, x, y, priceTop, priceBottom, min, max, maxVolume, entryIdx, exitIdx } = layout;
    if (!dayCandles.length) {
        return (
            <Box sx={{ height: 240, display: 'grid', placeItems: 'center', color: COLORS.text }}>
                <Typography>No candles for this day.</Typography>
            </Box>
        );
    }

    const bodyW = Math.max(2, Math.min(11, slotW * 0.62));
    const volTop = priceBottom + PANE_GAP;
    const volBottom = H - PAD.bottom;
    const plotRight = W - PAD.right;
    const isBuy = signal?.side === 'long';
    const first = dayCandles[0];
    const gapPct = signal?.gapPct;
    const exitPrice = signal?.exit ?? signal?.lastPrice;
    const rangeEndIdx = Math.min(dayStart + breakCandles, slots.length - 1);

    // price grid
    const gridLevels = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);

    // right-axis level pills
    const pills = spreadLabels(
        [
            Number.isFinite(Number(signal?.prevClose)) && { key: 'prev', y: y(signal.prevClose), text: `Prev ${fmt(signal.prevClose)}`, color: COLORS.prevClose },
            signal?.stop != null && { key: 'stop', y: y(signal.stop), text: `Stop ${fmt(signal.stop)}`, color: COLORS.stop },
            signal && { key: 'entry', y: y(signal.entry), text: `${isBuy ? 'Buy' : 'Sell'} ${fmt(signal.entry)}`, color: COLORS.entry },
            Number.isFinite(Number(exitPrice)) && { key: 'exit', y: y(exitPrice), text: `${signal?.closedAt ? 'Exit' : 'Last'} ${fmt(exitPrice)}`, color: COLORS.exit },
        ].filter(Boolean),
        17,
        priceTop,
        priceBottom
    );

    const hoverSlot = hover != null ? slots[hover] : null;

    return (
        <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 1.5 }}>
                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ fontSize: 12.5, color: COLORS.text }}>
                    {[
                        { color: COLORS.prevClose, label: 'Previous close', dash: true },
                        { color: COLORS.range, label: `1st candle range + ${breakCandles}-candle break window`, box: true },
                        { color: COLORS.entry, label: isBuy ? 'Buy entry' : 'Sell entry' },
                        { color: COLORS.stop, label: 'Stop', dash: true },
                        { color: COLORS.exit, label: 'Exit' },
                    ].map((item) => (
                        <Stack key={item.label} direction="row" spacing={0.75} alignItems="center">
                            <Box
                                sx={{
                                    width: item.box ? 14 : 18,
                                    height: item.box ? 10 : 0,
                                    borderTop: item.box ? 'none' : `2px ${item.dash ? 'dashed' : 'solid'} ${item.color}`,
                                    background: item.box ? `${item.color}26` : 'none',
                                    border: item.box ? `1px dashed ${item.color}` : undefined,
                                    borderRadius: item.box ? 0.5 : 0,
                                }}
                            />
                            <span>{item.label}</span>
                        </Stack>
                    ))}
                </Stack>
                <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
                    <ToggleButton value="both" disabled={!prevCandles.length} sx={{ textTransform: 'none', fontWeight: 700, px: 1.5 }}>
                        Both days
                    </ToggleButton>
                    <ToggleButton value="day" sx={{ textTransform: 'none', fontWeight: 700, px: 1.5 }}>
                        Signal day
                    </ToggleButton>
                </ToggleButtonGroup>
            </Stack>

            <Box sx={{ width: '100%', overflowX: 'auto', borderRadius: 3, border: '1px solid rgba(15,23,42,0.08)', background: '#fff' }}>
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    role="img"
                    aria-label="5 minute candles for the previous day and the signal day"
                    style={{ width: '100%', minWidth: 760, height: 'auto', display: 'block', fontFamily: 'inherit' }}
                    onMouseLeave={() => setHover(null)}
                >
                    {/* previous-day background and day headers */}
                    {showPrev && (
                        <rect x={PAD.left} y={PAD.top - 34} width={x(separatorStart - 1) + slotW / 2 - PAD.left} height={volBottom - PAD.top + 34} fill="#f8fafc" />
                    )}
                    {showPrev && (
                        <text x={(PAD.left + x(separatorStart - 1)) / 2} y={PAD.top - 16} textAnchor="middle" fontSize="13" fontWeight="700" fill={COLORS.text}>
                            {dayLabel(prevDay)} · previous day
                        </text>
                    )}
                    <text x={(x(dayStart) + plotRight) / 2} y={PAD.top - 16} textAnchor="middle" fontSize="13" fontWeight="800" fill={COLORS.ink}>
                        {dayLabel(day)} · signal day
                    </text>

                    {/* price grid */}
                    {gridLevels.map((p) => (
                        <g key={p}>
                            <line x1={PAD.left} x2={plotRight} y1={y(p)} y2={y(p)} stroke={COLORS.grid} />
                            <text x={plotRight + 8} y={y(p) + 4} fontSize="11" fill={COLORS.axis}>
                                {fmt(p)}
                            </text>
                        </g>
                    ))}

                    {/* separator between the two sessions */}
                    {showPrev && (
                        <line
                            x1={x(separatorStart + SEPARATOR_SLOTS / 2 - 0.5)}
                            x2={x(separatorStart + SEPARATOR_SLOTS / 2 - 0.5)}
                            y1={PAD.top - 34}
                            y2={volBottom}
                            stroke={COLORS.axis}
                            strokeDasharray="3 4"
                        />
                    )}

                    {/* 1st candle range + break window */}
                    <rect
                        x={x(dayStart) - slotW / 2}
                        y={y(first.high)}
                        width={x(rangeEndIdx) - x(dayStart) + slotW}
                        height={Math.max(2, y(first.low) - y(first.high))}
                        fill={`${COLORS.range}22`}
                        stroke={COLORS.range}
                        strokeDasharray="4 3"
                        rx="3"
                    />

                    {/* previous close */}
                    {Number.isFinite(Number(signal?.prevClose)) && (
                        <line x1={PAD.left} x2={plotRight} y1={y(signal.prevClose)} y2={y(signal.prevClose)} stroke={COLORS.prevClose} strokeDasharray="6 5" strokeWidth="1.4" />
                    )}

                    {/* gap bracket */}
                    {Number.isFinite(Number(signal?.prevClose)) && (
                        (() => {
                            const gx = showPrev ? x(separatorStart + SEPARATOR_SLOTS / 2 - 0.5) : x(dayStart) - slotW;
                            const y1 = y(signal.prevClose);
                            const y2 = y(first.open);
                            const up = y2 < y1;
                            const color = up ? COLORS.up : COLORS.down;
                            // badge sits left of the arrow (over the gap between sessions) so it doesn't hide candles
                            const badgeX = showPrev ? gx - 92 : gx + 8;
                            return (
                                <g>
                                    <line x1={gx} x2={gx} y1={y1} y2={y2} stroke={color} strokeWidth="3" />
                                    <path d={up ? `M${gx - 5},${y2 + 7} L${gx},${y2} L${gx + 5},${y2 + 7}` : `M${gx - 5},${y2 - 7} L${gx},${y2} L${gx + 5},${y2 - 7}`} fill="none" stroke={color} strokeWidth="3" />
                                    <rect x={badgeX} y={(y1 + y2) / 2 - 11} width="84" height="22" rx="11" fill={color} />
                                    <text x={badgeX + 42} y={(y1 + y2) / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">
                                        {`Gap ${gapPct > 0 ? '+' : ''}${Number(gapPct).toFixed(2)}%`}
                                    </text>
                                </g>
                            );
                        })()
                    )}

                    {/* entry -> exit levels */}
                    {entryIdx >= 0 && (
                        <g>
                            <line x1={x(entryIdx)} x2={x(exitIdx)} y1={y(signal.entry)} y2={y(signal.entry)} stroke={COLORS.entry} strokeWidth="2" />
                            {signal.stop != null && (
                                <line x1={x(entryIdx)} x2={x(exitIdx)} y1={y(signal.stop)} y2={y(signal.stop)} stroke={COLORS.stop} strokeWidth="1.6" strokeDasharray="7 4" />
                            )}
                        </g>
                    )}

                    {/* candles + volume */}
                    {slots.map((s, i) => {
                        if (!s) return null;
                        const { c } = s;
                        const green = c.close >= c.open;
                        const color = green ? COLORS.up : COLORS.down;
                        const top = y(Math.max(c.open, c.close));
                        const bodyH = Math.max(1.2, Math.abs(y(c.open) - y(c.close)));
                        const volH = ((c.volume || 0) / maxVolume) * (VOLUME_HEIGHT - 6);
                        const faded = s.session === 'prev' ? 0.75 : 1;
                        return (
                            <g key={`${s.session}-${c.date}`} opacity={faded}>
                                <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.2" />
                                <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} rx="0.8" />
                                <rect x={x(i) - bodyW / 2} y={volBottom - volH} width={bodyW} height={volH} fill={color} opacity="0.35" />
                            </g>
                        );
                    })}

                    {/* volume pane frame */}
                    <line x1={PAD.left} x2={plotRight} y1={volTop} y2={volTop} stroke={COLORS.grid} />
                    <text x={plotRight + 8} y={volTop + 12} fontSize="10.5" fill={COLORS.axis}>
                        Volume
                    </text>

                    {/* entry / exit markers */}
                    {entryIdx >= 0 && (
                        <g>
                            {isBuy ? (
                                <path d={`M${x(entryIdx)},${y(signal.entry) + 6} l-7,12 l14,0 z`} fill={COLORS.entry} stroke="#fff" strokeWidth="1.5" />
                            ) : (
                                <path d={`M${x(entryIdx)},${y(signal.entry) - 6} l-7,-12 l14,0 z`} fill={COLORS.entry} stroke="#fff" strokeWidth="1.5" />
                            )}
                        </g>
                    )}
                    {signal?.closedAt && exitIdx >= 0 && (
                        <circle cx={x(exitIdx)} cy={y(signal.exit)} r="6" fill={COLORS.exit} stroke="#fff" strokeWidth="2" />
                    )}

                    {/* time axis: every hour from 9:15 */}
                    <line x1={PAD.left} x2={plotRight} y1={volBottom} y2={volBottom} stroke={COLORS.axis} />
                    {slots.map((s, i) =>
                        s && istMinute(s.c.date) % 60 === 15 ? (
                            <text key={`t-${s.session}-${s.c.date}`} x={x(i)} y={volBottom + 18} textAnchor="middle" fontSize="11" fill={COLORS.text}>
                                {istTime(s.c.date)}
                            </text>
                        ) : null
                    )}

                    {/* right-axis level pills */}
                    {pills.map((p) => (
                        <g key={p.key}>
                            <rect x={plotRight + 4} y={p.y - 9} width={PAD.right - 8} height="18" rx="9" fill={p.color} />
                            <text x={plotRight + 4 + (PAD.right - 8) / 2} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
                                {p.text}
                            </text>
                        </g>
                    ))}

                    {/* hover: crosshair + tooltip */}
                    {slots.map((s, i) =>
                        s ? (
                            <rect key={`h-${s.session}-${s.c.date}`} x={x(i) - slotW / 2} y={PAD.top - 34} width={slotW} height={volBottom - PAD.top + 34} fill="transparent" onMouseEnter={() => setHover(i)} />
                        ) : null
                    )}
                    {hoverSlot &&
                        (() => {
                            const c = hoverSlot.c;
                            const tw = 168;
                            const th = 104;
                            const tx = x(hover) + 14 + tw > plotRight ? x(hover) - 14 - tw : x(hover) + 14;
                            const ty = Math.min(Math.max(priceTop, y(c.high) - th / 2), priceBottom - th);
                            const change = ((c.close - c.open) / c.open) * 100;
                            return (
                                <g pointerEvents="none">
                                    <line x1={x(hover)} x2={x(hover)} y1={PAD.top - 34} y2={volBottom} stroke={COLORS.ink} strokeOpacity="0.25" strokeDasharray="3 3" />
                                    <rect x={tx} y={ty} width={tw} height={th} rx="8" fill={COLORS.ink} opacity="0.94" />
                                    <text x={tx + 12} y={ty + 20} fontSize="12" fontWeight="800" fill="#fff">
                                        {`${dayLabel(hoverSlot.session === 'prev' ? prevDay : day)} · ${istTime(c.date)}`}
                                    </text>
                                    {[
                                        ['Open', fmt(c.open)],
                                        ['High', fmt(c.high)],
                                        ['Low', fmt(c.low)],
                                        ['Close', `${fmt(c.close)}  (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`],
                                    ].map(([k, v], row) => (
                                        <text key={k} x={tx + 12} y={ty + 40 + row * 15} fontSize="11.5" fill="#cbd5e1">
                                            <tspan fontWeight="700" fill="#fff">{k}</tspan> {v}
                                        </text>
                                    ))}
                                    <text x={tx + 12} y={ty + 98} fontSize="11.5" fill="#cbd5e1">
                                        <tspan fontWeight="700" fill="#fff">Vol</tspan> {Number(c.volume || 0).toLocaleString('en-IN')}
                                    </text>
                                </g>
                            );
                        })()}
                </svg>
            </Box>
        </Box>
    );
};

export default TwoDayChart;
