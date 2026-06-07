import { useState, useEffect, useMemo } from 'react';
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { stocks65To70, stocks70To75, stocks75To80, stocks80To100, stocks80To100_2, stocks70To75_2 } from '../constants/stock';

const getCandleDay = (value) => value?.split?.('T')?.[0] || value?.split?.(' ')?.[0] || '';

const formatCandleTime = (value) => {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value.split?.('T')?.[1]?.slice(0, 5) || value;
    }

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const DayCandleChart = ({ candles, hit }) => {
    const [hoveredIndex, setHoveredIndex] = useState(null);
    const [zoom, setZoom] = useState(1);
    const width = 980;
    const height = 360;
    const padding = { top: 18, right: 58, bottom: 40, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const prices = candles.flatMap((candle) => [candle.high, candle.low]).filter((value) => Number.isFinite(Number(value)));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice || 1;
    const candleGap = candles.length > 1 ? chartWidth / (candles.length - 1) : chartWidth;
    const candleWidth = Math.max(6, Math.min(16, candleGap * 0.68));
    const yForPrice = (price) => padding.top + ((maxPrice - Number(price)) / range) * chartHeight;
    const xForIndex = (index) => padding.left + (candles.length > 1 ? index * candleGap : chartWidth / 2);
    const gridPrices = Array.from({ length: 5 }, (_, index) => minPrice + (range * index) / 4).reverse();
    const timeLabels = candles.length
        ? [0, Math.floor(candles.length / 2), candles.length - 1].filter((value, index, arr) => arr.indexOf(value) === index)
        : [];
    const hitPrice = Number(hit?.buyOrSellPrice);
    const showHitPrice = candles.length && Number.isFinite(hitPrice);
    const hitColor = hit?.direction === 'down' ? '#dc2626' : '#16a34a';
    const hoveredCandle = hoveredIndex !== null ? candles[hoveredIndex] : null;
    const hitCandleIndex = showHitPrice
        ? candles.findIndex((candle) => (
            hit?.direction === 'down'
                ? Number(candle.low) <= hitPrice
                : Number(candle.high) >= hitPrice
        ))
        : -1;
    const hitLineX = hitCandleIndex >= 0 ? xForIndex(hitCandleIndex) : padding.left + 68;
    const hitLineStart = Math.max(padding.left, hitLineX - 44);
    const hitLineEnd = Math.min(width - padding.right, hitLineX + 44);

    if (!candles.length) {
        return (
            <Box sx={{ height: 240, display: 'grid', placeItems: 'center', color: '#64748b' }}>
                <Typography>No candles found for this day.</Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mb: 1 }}>
                <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}
                    disabled={zoom <= 1}
                    sx={{ minWidth: 38, fontWeight: 800 }}
                >
                    -
                </Button>
                <Chip
                    label={`${Math.round(zoom * 100)}%`}
                    sx={{ fontWeight: 800, color: '#0f3d3e', backgroundColor: 'rgba(15, 61, 62, 0.08)' }}
                />
                <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setZoom((value) => Math.min(5, Number((value + 0.25).toFixed(2))))}
                    disabled={zoom >= 5}
                    sx={{ minWidth: 38, fontWeight: 800 }}
                >
                    +
                </Button>
            </Stack>
            <Box sx={{ width: '100%', overflowX: 'auto', pb: 1 }}>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="5 minute candle chart" style={{ minWidth: 520 * zoom, width: `${100 * zoom}%`, height: 'auto' }}>
                <rect x="0" y="0" width={width} height={height} rx="12" fill="#ffffff" />
                {gridPrices.map((price) => {
                    const y = yForPrice(price);
                    return (
                        <g key={price}>
                            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                            <text x={width - padding.right + 10} y={y + 4} fontSize="11" fill="#64748b">
                                {price.toFixed(2)}
                            </text>
                        </g>
                    );
                })}
                {showHitPrice ? (
                    <g>
                        <line
                            x1={hitLineStart}
                            x2={hitLineEnd}
                            y1={yForPrice(hitPrice)}
                            y2={yForPrice(hitPrice)}
                            stroke={hitColor}
                            strokeWidth="2"
                            strokeDasharray="8 5"
                        />
                        {hitCandleIndex >= 0 ? (
                            <circle
                                cx={hitLineX}
                                cy={yForPrice(hitPrice)}
                                r="5"
                                fill="#ffffff"
                                stroke={hitColor}
                                strokeWidth="2"
                            />
                        ) : null}
                    </g>
                ) : null}
                {candles.map((candle, index) => {
                    const open = Number(candle.open);
                    const close = Number(candle.close);
                    const high = Number(candle.high);
                    const low = Number(candle.low);
                    const x = xForIndex(index);
                    const isGreen = close >= open;
                    const color = isGreen ? '#16a34a' : '#dc2626';
                    const bodyTop = yForPrice(Math.max(open, close));
                    const openY = yForPrice(open);
                    const closeY = yForPrice(close);
                    const highY = yForPrice(high);
                    const lowY = yForPrice(low);
                    const bodyHeight = Math.max(5, Math.abs(openY - closeY));
                    const bodyY = Math.abs(openY - closeY) < 5 ? bodyTop - 2.5 : bodyTop;

                    return (
                        <g
                            key={`${candle.date}-${index}`}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            style={{ cursor: 'crosshair' }}
                        >
                            <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="2" />
                            <rect
                                x={x - candleWidth / 2}
                                y={bodyY}
                                width={candleWidth}
                                height={bodyHeight}
                                fill={color}
                            />
                            <rect
                                x={x - Math.max(candleWidth, 8) / 2}
                                y={highY}
                                width={Math.max(candleWidth, 10)}
                                height={Math.max(8, lowY - highY)}
                                fill="transparent"
                            />
                        </g>
                    );
                })}
                <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="#94a3b8" />
                <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="#94a3b8" />
                {timeLabels.map((index) => {
                    const x = xForIndex(index);
                    return (
                        <text key={index} x={x} y={height - 14} textAnchor="middle" fontSize="11" fill="#64748b">
                            {formatCandleTime(candles[index]?.date)}
                        </text>
                    );
                })}
                {hoveredCandle ? (() => {
                    const high = Number(hoveredCandle.high);
                    const low = Number(hoveredCandle.low);
                    const close = Number(hoveredCandle.close);
                    const tooltipWidth = 148;
                    const tooltipHeight = 70;
                    const candleX = xForIndex(hoveredIndex);
                    const x = Math.min(Math.max(candleX + 10, padding.left), width - padding.right - tooltipWidth);
                    const y = Math.max(padding.top + 4, yForPrice(high) - tooltipHeight - 10);

                    return (
                        <g pointerEvents="none">
                            <rect
                                x={x}
                                y={y}
                                width={tooltipWidth}
                                height={tooltipHeight}
                                rx="6"
                                fill="#0f172a"
                                opacity="0.94"
                            />
                            <text x={x + 10} y={y + 18} fontSize="12" fontWeight="700" fill="#ffffff">
                                {formatCandleTime(hoveredCandle.date)}
                            </text>
                            <text x={x + 10} y={y + 36} fontSize="12" fill="#dbeafe">
                                {`High: ${high.toFixed(2)}`}
                            </text>
                            <text x={x + 10} y={y + 51} fontSize="12" fill="#fee2e2">
                                {`Low: ${low.toFixed(2)}`}
                            </text>
                            <text x={x + 10} y={y + 66} fontSize="12" fill="#dcfce7">
                                {`Close: ${close.toFixed(2)}`}
                            </text>
                        </g>
                    );
                })() : null}
            </svg>
            </Box>
        </Box>
    );
};

const baseColumns = [
    {
        field: 'time',
        headerName: 'Date',
        minWidth: 190,
        flex: 1,
        renderCell: (params) => {
            if (!params.value) {
                return '-';
            }

            const date = new Date(params.value);
            return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
        },
    },
    {
        field: 'direction',
        headerName: 'Direction',
        minWidth: 120,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value || '-'}
                sx={{
                    textTransform: 'capitalize',
                    fontWeight: 700,
                    backgroundColor: params.value === 'up' ? 'rgba(20,184,166,0.14)' : 'rgba(245,158,11,0.18)',
                    color: params.value === 'up' ? '#115e59' : '#92400e',
                }}
            />
        ),
    },
    {
        field: 'hit',
        headerName: 'Hit',
        minWidth: 100,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value ? 'Yes' : 'No'}
                sx={{
                    fontWeight: 700,
                    backgroundColor: params.value ? 'rgba(16,185,129,0.16)' : 'rgba(148,163,184,0.18)',
                    color: params.value ? '#047857' : '#475569',
                }}
            />
        ),
    },
    {
        field: 'inProgress',
        headerName: 'Status',
        minWidth: 120,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value ? 'Active' : 'Closed'}
                sx={{
                    fontWeight: 700,
                    backgroundColor: params.value ? 'rgba(34,197,94,0.14)' : 'rgba(148,163,184,0.18)',
                    color: params.value ? '#166534' : '#475569',
                }}
            />
        ),
    },
    {
        field: 'isSucess',
        headerName: 'Valid',
        minWidth: 110,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value ? 'Yes' : 'No'}
                sx={{
                    fontWeight: 700,
                    backgroundColor: params.value ? 'rgba(59,130,246,0.14)' : 'rgba(239,68,68,0.14)',
                    color: params.value ? '#1d4ed8' : '#b91c1c',
                }}
            />
        ),
    },
    {
        field: 'profitOrLoss',
        headerName: 'Profit',
        type: 'number',
        width: 130,
    },
    {
        field: 'buyOrSellPrice',
        headerName: 'Buy/Sell Price',
        type: 'number',
        width: 140,
        renderCell: (params) => params.value ?? '-',
    },
    {
        field: 'target',
        headerName: 'Target',
        width: 130,
        renderCell: (params) => params.value ?? '-',
    },
];

const AnalyticsSingle = ({ data, analysisFunction, label, name }) => {
    const [result, setResult] = useState([]);
    const [selectedHit, setSelectedHit] = useState(null);
    const isMobile = useMediaQuery('(max-width:600px)');

    const trackedStocks = useMemo(
        () => [...stocks65To70, ...stocks70To75, ...stocks75To80, ...stocks80To100, ...stocks80To100_2, ...stocks70To75_2],
        []
    );
    const storageAnalysis = localStorage?.getItem('analysis');
    if (!storageAnalysis) {
        localStorage?.setItem('analysis', JSON.stringify({}));
    }

    useEffect(() => {
        const tmpData = [...data];
        const resultsArray = [];
        let previousDayCandles = [];

        while (tmpData.length > 0) {
            const date = tmpData[0]?.date?.split('T')[0];
            const filterData = tmpData.filter((candle) => candle.date.includes(date));
            const dataToAnalys = tmpData.splice(0, filterData.length);

            if (dataToAnalys.length) {
                const ana = analysisFunction(dataToAnalys, previousDayCandles);
                if (ana?.hit) {
                    resultsArray.push({
                        ...ana,
                        id: resultsArray.length + 1,
                    });
                }
            }

            previousDayCandles = dataToAnalys;
        }

        setResult(resultsArray);
    }, [analysisFunction, data]);

    const summary = useMemo(() => {
        const totalProfit = result.reduce((sum, value) => sum + Number(value.profitOrLoss || 0), 0);
        const profitableTrades = result.filter((value) => Number(value.profitOrLoss || 0) > 0);
        const averageProfit = profitableTrades.length
            ? (
                profitableTrades.reduce((sum, value) => sum + Number(value.profitOrLoss || 0), 0) /
                profitableTrades.length
            ).toFixed(2)
            : '0.00';
        const percent = result.length ? ((profitableTrades.length * 100) / result.length).toFixed(1) : '0.0';

        return {
            totalProfit,
            averageProfit,
            percent,
            hits: result.length,
            wins: profitableTrades.length,
        };
    }, [result]);

    useEffect(() => {
        if (trackedStocks.includes(name)) {
            let storageAnalysis = JSON.parse(localStorage?.getItem('analysis'));
            const nameData = storageAnalysis[name]
                ? { ...storageAnalysis[name], [label.trim()]: summary.percent }
                : { [label.trim()]: summary.percent };
            storageAnalysis = { ...storageAnalysis, [name]: nameData };
            localStorage.setItem('analysis', JSON.stringify(storageAnalysis));
        }
    }, [label, name, summary.percent, trackedStocks]);

    const selectedDayCandles = useMemo(() => {
        const selectedDay = getCandleDay(selectedHit?.time);

        if (!selectedDay) {
            return [];
        }

        return data.filter((candle) => getCandleDay(candle?.date) === selectedDay);
    }, [data, selectedHit]);

    const columns = useMemo(
        () => [
            ...baseColumns,
            {
                field: 'chart',
                headerName: 'Chart',
                width: 130,
                sortable: false,
                filterable: false,
                renderCell: (params) => (
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setSelectedHit(params.row)}
                        sx={{
                            borderColor: 'rgba(15,118,110,0.32)',
                            color: '#0f766e',
                            fontWeight: 700,
                            textTransform: 'none',
                        }}
                    >
                        Open Chart
                    </Button>
                ),
            },
        ],
        []
    );

    return (
        <Box sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                    gap: 1.5,
                    mb: 2,
                }}
            >
                {[
                    { label: 'Total Profit', value: summary.totalProfit, tone: '#0f172a' },
                    { label: 'Avg Profit', value: summary.averageProfit, tone: '#0f766e' },
                    { label: 'Hit Count', value: `${summary.wins}/${summary.hits}`, tone: '#1d4ed8' },
                    { label: 'Win Rate', value: `${summary.percent}%`, tone: '#b45309' },
                ].map((item) => (
                    <Paper
                        key={item.label}
                        elevation={0}
                        sx={{
                            p: 1.5,
                            minWidth: 0,
                            borderRadius: 3,
                            border: '1px solid rgba(15, 23, 42, 0.08)',
                            background: 'rgba(255,255,255,0.86)',
                        }}
                    >
                        <Typography sx={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {item.label}
                        </Typography>
                        <Typography sx={{ mt: 0.5, fontSize: 24, fontWeight: 800, color: item.tone }}>
                            {item.value}
                        </Typography>
                    </Paper>
                ))}
            </Box>
            <Box sx={{ height: 400, width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}>
                <DataGrid
                    rows={result}
                    columns={columns}
                    disableRowSelectionOnClick
                    initialState={{
                        pagination: {
                            paginationModel: { page: 0, pageSize: 25 },
                        },
                    }}
                    pageSizeOptions={[10, 25, 50]}
                    sx={{
                        width: '100%',
                        maxWidth: '100%',
                        minWidth: 0,
                        '& .MuiDataGrid-main': {
                            width: '100%',
                        },
                    }}
                />
            </Box>
            <Dialog
                open={Boolean(selectedHit)}
                onClose={() => setSelectedHit(null)}
                fullWidth
                fullScreen={isMobile}
                maxWidth="lg"
            >
                <DialogTitle sx={{ pb: 1 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Box>
                            <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
                                5 min chart - {getCandleDay(selectedHit?.time)}
                            </Typography>
                            <Typography sx={{ fontSize: 13, color: '#64748b' }}>
                                Green candles close above open, red candles close below open. Hover a candle for OHLC prices.
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                                label={`${selectedDayCandles.length} candles`}
                                sx={{
                                    fontWeight: 700,
                                    color: '#0f3d3e',
                                    backgroundColor: 'rgba(15, 61, 62, 0.08)',
                                }}
                            />
                            <IconButton
                                aria-label="Close chart"
                                onClick={() => setSelectedHit(null)}
                                sx={{
                                    width: 34,
                                    height: 34,
                                    color: '#475569',
                                    border: '1px solid rgba(15, 23, 42, 0.12)',
                                }}
                            >
                                ×
                            </IconButton>
                        </Stack>
                    </Stack>
                </DialogTitle>
                <DialogContent sx={{ pt: 1 }}>
                    <DayCandleChart candles={selectedDayCandles} hit={selectedHit} />
                </DialogContent>
            </Dialog>
        </Box>
    );
};
export default AnalyticsSingle;
