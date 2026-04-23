import { useState, useEffect, useMemo } from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { stocks65To70, stocks70To75, stocks75To80, stocks80To100, stocks80To100_2, stocks70To75_2 } from '../constants/stock';

const columns = [
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
        </Box>
    );
};
export default AnalyticsSingle;
