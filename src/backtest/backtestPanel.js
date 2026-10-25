import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Box,
    Button,
    Chip,
    LinearProgress,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import { get, post } from "../utils/axios";
import SignalsPanel from "./signalsPanel";

const rupees = (value) => (value == null ? "-" : `₹${Number(value).toLocaleString("en-IN")}`);

const pnlColor = (value) => (value > 0 ? "#15803d" : value < 0 ? "#b91c1c" : "inherit");

const BacktestPanel = () => {
    const [backtest, setBacktest] = useState(null);
    const [error, setError] = useState("");

    const refresh = useCallback(() => {
        get("backtest/status").then((res) => setBacktest(res.data)).catch(() => {});
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, backtest?.running ? 3000 : 15000);
        return () => clearInterval(interval);
    }, [refresh, backtest?.running]);

    const call = (url, payload) => {
        setError("");
        return post(url, payload)
            .then(refresh)
            .catch((err) => setError(err?.response?.data?.error || err.message));
    };

    const results = backtest?.results;
    // candidates first, then by net P&L
    const variants = results
        ? Object.entries(results.variants).sort(([, a], [, b]) => (b.candidate ? 1 : 0) - (a.candidate ? 1 : 0) || (b.netPnl ?? -Infinity) - (a.netPnl ?? -Infinity))
        : [];

    return (
        <Stack spacing={3}>
            {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4, border: "1px solid rgba(15, 61, 62, 0.12)" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>Strategy Backtest (5-min candles)</Typography>
                        <Typography sx={{ color: "#475569", fontSize: 14 }}>
                            The paper-signal strategy (gap ≥ 1% fade) on the 100 most liquid F&O stocks, with and without the Nifty check, 2 years, after Zerodha charges and slippage.                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" disabled={backtest?.running} onClick={() => call("backtest/run", { years: 2 })}>
                            Run Backtest
                        </Button>
                        <Button variant="outlined" disabled={backtest?.running} onClick={() => call("backtest/run", { skipDownload: true })}>
                            Re-run (no download)
                        </Button>
                    </Stack>
                </Stack>

                {backtest?.running && (
                    <Box sx={{ mt: 2 }}>
                        <Typography sx={{ fontSize: 14, mb: 1 }}>
                            {backtest.stage === "download" ? "Downloading candles from Kite (about 5 minutes the first time, already-downloaded stocks are skipped)..." : "Running backtest..."}
                        </Typography>
                        <LinearProgress />
                    </Box>
                )}
                {backtest?.error && <Alert severity="error" sx={{ mt: 2 }}>{backtest.error}. See the log below.</Alert>}

                {backtest?.log?.length > 0 && (
                    <Box
                        component="pre"
                        sx={{ mt: 2, p: 1.5, maxHeight: 180, overflow: "auto", fontSize: 12, background: "#0f172a", color: "#e2e8f0", borderRadius: 2 }}
                    >
                        {backtest.log.join("\n")}
                    </Box>
                )}

                {results && (
                    <Box sx={{ mt: 2 }}>
                        <Typography sx={{ fontSize: 13, color: "#475569", mb: 1 }}>
                            {results.stocks} stocks · risk {rupees(results.settings.riskPerTrade)} per trade · slippage {results.settings.slippagePct}% per side ·
                            run {new Date(results.generatedAt).toLocaleString()}
                        </Typography>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Variant</TableCell>
                                        <TableCell align="right">Trades</TableCell>
                                        <TableCell align="right">Win %</TableCell>
                                        <TableCell align="right">Avg R</TableCell>
                                        <TableCell align="right">Net P&L</TableCell>
                                        <TableCell align="right">Charges</TableCell>
                                        <TableCell align="right">Profit factor</TableCell>
                                        <TableCell align="right">Max drawdown</TableCell>
                                        <TableCell align="right">1st half</TableCell>
                                        <TableCell align="right">2nd half</TableCell>
                                        <TableCell>Net by year</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {variants.map(([name, s]) => (
                                        <TableRow key={name} sx={s.candidate ? { backgroundColor: "rgba(21, 128, 61, 0.08)" } : undefined}>
                                            <TableCell sx={{ fontWeight: 600 }}>
                                                {s.candidate && <Chip size="small" color="success" label="candidate" sx={{ mr: 1 }} />}
                                                {name}
                                            </TableCell>
                                            <TableCell align="right">{s.trades}</TableCell>
                                            <TableCell align="right">{s.winRate ?? "-"}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.avgR) }}>{s.avgR ?? "-"}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.netPnl), fontWeight: 700 }}>{rupees(s.netPnl)}</TableCell>
                                            <TableCell align="right">{rupees(s.totalCharges)}</TableCell>
                                            <TableCell align="right">{s.profitFactor ?? "-"}</TableCell>
                                            <TableCell align="right">{rupees(s.maxDrawdown)}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.firstHalfNet) }}>{rupees(s.firstHalfNet)}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.secondHalfNet) }}>{rupees(s.secondHalfNet)}</TableCell>
                                            <TableCell sx={{ fontSize: 12 }}>
                                                {s.netByYear ? Object.entries(s.netByYear).map(([y, v]) => `${y}: ${rupees(v)}`).join(" · ") : "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 1 }}>
                            "candidate" = at least 100 trades, profit factor ≥ 1.15, and profit in both halves and every year of the period ({results.period?.splitDay ? `split at ${results.period.splitDay}` : "split by date"}).                            That is the minimum before paper trading a strategy, not a guarantee of future profit.
                        </Typography>
                    </Box>
                )}
            </Paper>

            <SignalsPanel />
        </Stack>
    );
};

export default BacktestPanel;
