import { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Stack,
    Tab,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { get } from '../utils/axios';
import TwoDayChart from './twoDayChart';
import DailyHoldChart from './dailyHoldChart';

const STRATEGY_TABS = [
    { key: 'gap', label: 'Gap fade' },
    { key: 'pullback', label: 'Gap + pullback' },
    { key: 'swing', label: '3-burst swing (15 days)' },
];

// History Analysis for one F&O stock: the selected paper-signal strategy (same rules as the live signals) run
// on the past months of 5-minute candles, one row per signal, with a two-day chart (and, for the 15-day swing,
// a daily chart of the hold) for each.

const price = (v) => (v == null ? '-' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const money = (v) => (v == null ? '-' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`);
const tone = (v) => (v > 0 ? '#15803d' : v < 0 ? '#b91c1c' : '#0f172a');
const istTime = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const longDate = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const resultLabel = (p) => {
    if (p.strategyKey === 'swing') return p.status === 'open' ? `Holding ${p.holdDay}/15` : 'Sold day 15';
    return p.status === 'open' ? 'Open' : p.exitReason === 'stop' ? 'Stop hit' : p.exitReason === 'target' ? 'Target' : 'Exit 15:15';
};
const pct = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);

const StatCard = ({ label, value, color = '#0f172a', hint }) => (
    <Paper elevation={0} sx={{ p: 1.75, borderRadius: 3, border: '1px solid rgba(15,23,42,0.08)', background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)', minWidth: 0 }}>
        <Typography sx={{ fontSize: 11.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</Typography>
        <Typography sx={{ mt: 0.5, fontSize: 24, fontWeight: 800, color, lineHeight: 1.15 }}>{value}</Typography>
        {hint && <Typography sx={{ mt: 0.25, fontSize: 12, color: '#94a3b8' }}>{hint}</Typography>}
    </Paper>
);

const StockSignalHistory = ({ instrumentToken, stockName, onClose }) => {
    const [months, setMonths] = useState(6);
    const [strategy, setStrategy] = useState('gap');
    const swing = strategy === 'swing';
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);
    const isMobile = useMediaQuery('(max-width:700px)');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        setSelected(null);
        get(`stock-history?token=${instrumentToken}&months=${months}&strategy=${strategy}`)
            .then((res) => active && setData(res.data))
            .catch((err) => {
                if (!active) return;
                const status = err?.response?.status;
                setData(null);
                setError(
                    status === 404
                        ? 'This stock is not in the F&O list, so the gap strategy does not apply to it.'
                        : err?.response?.data?.error || err.message
                );
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [instrumentToken, months, strategy]);

    const chartButton = (p) => (
        <Button size="small" variant="contained" disableElevation onClick={() => setSelected(p.row)} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#0f766e', '&:hover': { backgroundColor: '#115e59' } }}>
            Chart
        </Button>
    );
    const swingColumns = useMemo(
        () => [
            { field: 'day', headerName: 'Bought', minWidth: 150, flex: 1, renderCell: (p) => <b>{longDate(p.value)}</b> },
            { field: 'exitDay', headerName: 'Sold (day 15)', minWidth: 140, flex: 1, renderCell: (p) => (p.value ? longDate(p.value) : '—') },
            { field: 'entry', headerName: 'Buy (close)', width: 115, renderCell: (p) => price(p.value) },
            { field: 'exit', headerName: 'Sell / last', width: 115, renderCell: (p) => price(p.value ?? p.row.lastPrice) },
            {
                field: 'status',
                headerName: 'Result',
                width: 120,
                renderCell: (p) => <span style={{ fontWeight: 700, color: p.row.status === 'open' ? '#1d4ed8' : '#0f766e' }}>{resultLabel(p.row)}</span>,
            },
            { field: 'returnPct', headerName: 'Return', width: 95, renderCell: (p) => <span style={{ fontWeight: 800, color: tone(p.value) }}>{pct(p.value)}</span> },
            { field: 'pnl', headerName: 'Paper P&L', width: 120, renderCell: (p) => <span style={{ fontWeight: 800, color: tone(p.value) }}>{money(p.value)}</span> },
            { field: 'chart', headerName: 'Chart', width: 110, sortable: false, filterable: false, renderCell: chartButton },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );
    const columns = useMemo(
        () => [
            { field: 'day', headerName: 'Date', minWidth: 150, flex: 1, renderCell: (p) => <b>{longDate(p.value)}</b> },
            {
                field: 'side',
                headerName: 'Signal',
                width: 100,
                renderCell: (p) => <Chip size="small" label={p.value === 'long' ? 'BUY' : 'SELL'} color={p.value === 'long' ? 'success' : 'error'} sx={{ fontWeight: 800 }} />,
            },
            {
                field: 'gapPct',
                headerName: 'Gap',
                width: 90,
                renderCell: (p) => <span style={{ fontWeight: 700, color: tone(p.value) }}>{`${p.value > 0 ? '+' : ''}${Number(p.value).toFixed(2)}%`}</span>,
            },
            { field: 'time', headerName: 'Entry time', width: 100, renderCell: (p) => istTime(p.value) },
            { field: 'entry', headerName: 'Entry', width: 110, renderCell: (p) => price(p.value) },
            { field: 'stop', headerName: 'Stop', width: 110, renderCell: (p) => price(p.value) },
            { field: 'exit', headerName: 'Exit', width: 110, renderCell: (p) => price(p.value ?? p.row.lastPrice) },
            {
                field: 'exitReason',
                headerName: 'Result',
                width: 110,
                renderCell: (p) => {
                    const label = resultLabel(p.row);
                    const color = label === 'Stop hit' ? '#b91c1c' : label === 'Open' ? '#1d4ed8' : '#0f766e';
                    return <span style={{ fontWeight: 700, color }}>{label}</span>;
                },
            },
            { field: 'r', headerName: 'R', width: 70, renderCell: (p) => <span style={{ fontWeight: 700, color: tone(p.value) }}>{p.value ?? '-'}</span> },
            { field: 'pnl', headerName: 'Paper P&L', width: 120, renderCell: (p) => <span style={{ fontWeight: 800, color: tone(p.value) }}>{money(p.value)}</span> },
            {
                field: 'chart',
                headerName: 'Chart',
                width: 110,
                sortable: false,
                filterable: false,
                renderCell: (p) => (
                    <Button size="small" variant="contained" disableElevation onClick={() => setSelected(p.row)} sx={{ textTransform: 'none', fontWeight: 700, backgroundColor: '#0f766e', '&:hover': { backgroundColor: '#115e59' } }}>
                        Chart
                    </Button>
                ),
            },
        ],
        []
    );

    const summary = data?.summary;
    const rules = data?.rules;

    return (
        <Paper
            elevation={0}
            sx={{
                p: { xs: 2, md: 3 },
                borderRadius: 5,
                border: '1px solid rgba(15, 61, 62, 0.08)',
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 24px 60px rgba(15, 61, 62, 0.08)',
                minWidth: 0,
                height: '100%',
            }}
        >
            <Stack spacing={2.5} sx={{ minWidth: 0 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Chip label="History Analysis · strategy backtest" sx={{ fontWeight: 800, color: '#0f3d3e', backgroundColor: 'rgba(15, 61, 62, 0.08)' }} />
                    <Stack direction="row" spacing={1} alignItems="center">
                        <ToggleButtonGroup size="small" exclusive value={months} onChange={(_, v) => v && setMonths(v)}>
                            {[3, 6, 12].map((m) => (
                                <ToggleButton key={m} value={m} sx={{ textTransform: 'none', fontWeight: 700, px: 1.5 }}>
                                    {m}M
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                        {onClose && (
                            <Button variant="outlined" onClick={onClose} sx={{ borderColor: 'rgba(15,61,62,0.18)', color: '#0f3d3e', fontWeight: 700 }}>
                                Hide
                            </Button>
                        )}
                    </Stack>
                </Stack>

                <Tabs
                    value={strategy}
                    onChange={(_, v) => setStrategy(v)}
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{ borderBottom: '1px solid rgba(15,23,42,0.08)', '& .MuiTab-root': { textTransform: 'none', fontWeight: 800 } }}
                >
                    {STRATEGY_TABS.map((t) => (
                        <Tab key={t.key} value={t.key} label={t.label} />
                    ))}
                </Tabs>

                <Box>
                    <Typography variant="h3" sx={{ fontSize: { xs: '1.8rem', md: '2.3rem' }, lineHeight: 1, color: '#0f172a', fontWeight: 800, letterSpacing: '-0.04em', overflowWrap: 'anywhere' }}>
                        {data?.symbol || stockName}
                    </Typography>
                    <Typography sx={{ mt: 1, color: '#64748b', fontSize: 14 }}>
                        {data?.name ? `${data.name} · ` : ''}
                        {data?.strategyInfo
                            ? `${data.strategyInfo.label}: ${data.strategyInfo.rules.join(' · ')} · past ${months} months of 5-min candles · P&L uses 1/3 of balance (${money(data.slotCapital)}) per trade, before charges`
                            : `Past ${months} months of 5-minute candles, same rules as the paper signals.`}
                    </Typography>
                </Box>

                {loading && (
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ color: '#0f766e', py: 2 }}>
                        <CircularProgress size={22} sx={{ color: '#0f766e' }} />
                        <Typography>Loading {months} months of 5-minute candles and running the strategy...</Typography>
                    </Stack>
                )}
                {!loading && error && <Alert severity="warning">{error}</Alert>}

                {!loading && data && (
                    <>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' }, gap: 1.5 }}>
                            <StatCard label="Signals" value={summary.signals} hint={swing ? `3-burst days in ${data.tradingDays} sessions` : `${data.gapDays} gap days in ${data.tradingDays} sessions`} />
                            <StatCard label="Win rate" value={summary.winRate == null ? '-' : `${summary.winRate}%`} color="#b45309" hint={`${summary.wins} winners`} />
                            <StatCard label="Paper P&L" value={money(summary.totalPnl)} color={tone(summary.totalPnl)} hint="before charges" />
                            {swing ? (
                                <StatCard label="Avg return" value={pct(summary.avgR)} color={tone(summary.avgR)} hint="per 15-day hold" />
                            ) : (
                                <StatCard label="Avg R" value={summary.avgR ?? '-'} color={tone(summary.avgR)} hint="points made / points risked" />
                            )}
                            <StatCard label="Max drawdown" value={money(summary.maxDrawdown)} color="#b91c1c" hint="worst peak-to-trough" />
                            <StatCard label="Period" value={`${months}M`} hint={`${longDate(data.from)} → today`} />
                        </Box>

                        {data.signals.length ? (
                            <Box sx={{ height: 460, width: '100%', minWidth: 0 }}>
                                <DataGrid
                                    rows={data.signals}
                                    columns={swing ? swingColumns : columns}
                                    disableRowSelectionOnClick
                                    onRowDoubleClick={(p) => setSelected(p.row)}
                                    initialState={{ pagination: { paginationModel: { page: 0, pageSize: 25 } } }}
                                    pageSizeOptions={[10, 25, 50]}
                                    sx={{
                                        border: '1px solid rgba(15,23,42,0.08)',
                                        borderRadius: 3,
                                        '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f8fafc', fontWeight: 800 },
                                        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 800, color: '#334155' },
                                        '& .MuiDataGrid-row:hover': { backgroundColor: 'rgba(15,118,110,0.05)' },
                                    }}
                                />
                            </Box>
                        ) : (
                            <Alert severity="info">No day in this period matched the strategy for {data.symbol}.</Alert>
                        )}
                    </>
                )}
            </Stack>

            <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth fullScreen={isMobile} maxWidth="xl">
                {selected && data && (
                    <>
                        <DialogTitle sx={{ pb: 1 }}>
                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                                <Box>
                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                        <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{data.symbol}</Typography>
                                        <Chip size="small" label={selected.side === 'long' ? 'BUY' : 'SELL'} color={selected.side === 'long' ? 'success' : 'error'} sx={{ fontWeight: 800 }} />
                                        <Chip size="small" variant="outlined" label={longDate(selected.day)} sx={{ fontWeight: 700 }} />
                                    </Stack>
                                    <Typography sx={{ mt: 0.5, fontSize: 13.5, color: '#64748b' }}>
                                        {selected.strategyKey === 'swing'
                                            ? `3 bursts on ${longDate(selected.day)} · bought at the close ${price(selected.entry)} · ${selected.status === 'open' ? `holding day ${selected.holdDay}/15, last ${price(selected.lastPrice)}` : `sold on ${longDate(selected.exitDay)} at ${price(selected.exit)}`}`
                                            : `Gap ${selected.gapPct > 0 ? '+' : ''}${selected.gapPct}% from ${price(selected.prevClose)} · ${selected.side === 'long' ? 'bought' : 'sold'} at ${price(selected.entry)} (${istTime(selected.time)}) · stop ${price(selected.stop)} · ${resultLabel(selected).toLowerCase()} at ${price(selected.exit ?? selected.lastPrice)}`}
                                    </Typography>
                                </Box>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Chip
                                        label={selected.strategyKey === 'swing' ? pct(selected.returnPct) : `R ${selected.r ?? '-'}`}
                                        sx={{ fontWeight: 800, color: tone(selected.r), backgroundColor: 'rgba(15,23,42,0.05)' }}
                                    />
                                    <Chip label={money(selected.pnl)} sx={{ fontWeight: 800, color: '#fff', backgroundColor: selected.pnl >= 0 ? '#15803d' : '#b91c1c' }} />
                                    <IconButton aria-label="Close chart" onClick={() => setSelected(null)} sx={{ width: 34, height: 34, border: '1px solid rgba(15,23,42,0.12)' }}>
                                        ×
                                    </IconButton>
                                </Stack>
                            </Stack>
                        </DialogTitle>
                        <DialogContent sx={{ pt: 1 }}>
                            {selected.strategyKey === 'swing' ? (
                                <Stack spacing={2}>
                                    <Box>
                                        <Typography sx={{ fontWeight: 800, mb: 1 }}>Buy day (5-min): the 3 bursts, bought at the close</Typography>
                                        <TwoDayChart
                                            prevDay={selected.prevDay}
                                            prevCandles={data.candles[selected.prevDay] || []}
                                            day={selected.day}
                                            dayCandles={data.candles[selected.day] || []}
                                            signal={{ ...selected, stop: null, exit: null, lastPrice: null, closedAt: null }}
                                            showGap={false}
                                            showRange={false}
                                        />
                                    </Box>
                                    <Box>
                                        <Typography sx={{ fontWeight: 800, mb: 1 }}>The 15-day hold (daily)</Typography>
                                        <DailyHoldChart bars={selected.holdDaily || []} entry={selected.entry} exit={selected.exit} holdDays={rules?.holdDays ?? 15} />
                                    </Box>
                                </Stack>
                            ) : (
                                <TwoDayChart
                                    prevDay={selected.prevDay}
                                    prevCandles={data.candles[selected.prevDay] || []}
                                    day={selected.day}
                                    dayCandles={data.candles[selected.day] || []}
                                    signal={selected}
                                    breakCandles={rules?.breakCandles ?? 3}
                                />
                            )}
                        </DialogContent>
                    </>
                )}
            </Dialog>
        </Paper>
    );
};

export default StockSignalHistory;
