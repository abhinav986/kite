import { useState, useEffect } from 'react';
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { get } from '../utils/axios';
import { useParams } from 'react-router-dom';
import AnalyticsSingle from './analysisSingle';
import { engulfe } from '../utils/analysis';

const AnalyticsHome = ({ instrumentToken, stockName, embedded = false, onClose }) => {
    const { id, name } = useParams();
    const resolvedId = instrumentToken || id;
    const resolvedName = stockName || name;
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const decodedName = decodeURIComponent(resolvedName || '');

    useEffect(() => {
        if (!resolvedId) {
            setData([]);
            setLoading(false);
            return;
        }

        let active = true;

        setLoading(true);
        get(`historyData/?id=${resolvedId}`).then((res) => {
            if (active) {
                setData(res.data || []);
                setLoading(false);
            }
        }).catch(() => {
            if (active) {
                setLoading(false);
            }
        });

        return () => {
            active = false;
        };
    }, [resolvedId]);

    return (
        <Box
            sx={{
                minHeight: embedded ? 'auto' : '100vh',
                background: embedded
                    ? 'transparent'
                    : 'radial-gradient(circle at top left, rgba(20,184,166,0.16), transparent 26%), linear-gradient(180deg, #f8fafc 0%, #eefbf8 100%)',
                p: embedded ? 0 : { xs: 2, md: 4 },
                width: '100%',
                height: embedded ? '100%' : 'auto',
                display: embedded ? 'flex' : 'block',
            }}
        >
            <Paper
                elevation={0}
                sx={{
                    maxWidth: embedded ? '100%' : 1400,
                    mx: 'auto',
                    p: { xs: 2, md: 3 },
                    borderRadius: 5,
                    border: '1px solid rgba(15, 61, 62, 0.08)',
                    background: 'rgba(255,255,255,0.9)',
                    boxShadow: '0 24px 60px rgba(15, 61, 62, 0.08)',
                    height: embedded ? '100%' : 'auto',
                    display: 'flex',
                    flex: embedded ? 1 : 'initial',
                }}
            >
                <Stack spacing={3} sx={{ flex: 1 }}>
                    <Box>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                            <Chip
                                label="History Analysis"
                                sx={{
                                    mb: { xs: 0, sm: 2 },
                                    fontWeight: 800,
                                    color: '#0f3d3e',
                                    backgroundColor: 'rgba(15, 61, 62, 0.08)',
                                }}
                            />
                            {embedded && onClose ? (
                                <Button
                                    variant="outlined"
                                    onClick={onClose}
                                    sx={{
                                        borderColor: 'rgba(15,61,62,0.18)',
                                        color: '#0f3d3e',
                                        fontWeight: 700,
                                    }}
                                >
                                    Hide Analysis
                                </Button>
                            ) : null}
                        </Stack>
                        <Typography
                            variant="h3"
                            sx={{
                                fontSize: { xs: '2rem', md: '2.6rem' },
                                lineHeight: 1,
                                color: '#0f172a',
                                fontWeight: 800,
                                letterSpacing: '-0.04em',
                            }}
                        >
                            {decodedName}
                        </Typography>
                        <Typography sx={{ mt: 1, color: '#64748b' }}>
                            Past 2 months, 5-minute engulfe analysis for the selected stock.
                        </Typography>
                    </Box>

                    {loading ? (
                        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ color: '#0f766e' }}>
                            <CircularProgress size={22} sx={{ color: '#0f766e' }} />
                            <Typography>Loading historical candles...</Typography>
                        </Stack>
                    ) : (
                        <div className='analysis-home'>
                            <AnalyticsSingle
                                data={[...data]}
                                name={decodedName}
                                analysisFunction={engulfe}
                                label='Engulfe total' />
                        </div>
                    )}
                </Stack>
            </Paper>
        </Box>
    );
};
export default AnalyticsHome;
