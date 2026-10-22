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

const rupees = (value) => (value == null ? "-" : `₹${Number(value).toLocaleString("en-IN")}`);

const pnlColor = (value) => (value > 0 ? "#15803d" : value < 0 ? "#b91c1c" : "inherit");

const BacktestPanel = () => {
    const [backtest, setBacktest] = useState(null);
    const [trader, setTrader] = useState(null);
    const [error, setError] = useState("");

    const refresh = useCallback(() => {
        get("backtest/status").then((res) => setBacktest(res.data)).catch(() => {});
        get("autotrader/status").then((res) => setTrader(res.data)).catch(() => {});
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, backtest?.running || trader?.enabled ? 3000 : 15000);
        return () => clearInterval(interval);
    }, [refresh, backtest?.running, trader?.enabled]);

    const call = (url, payload) => {
        setError("");
        return post(url, payload)
            .then(refresh)
            .catch((err) => setError(err?.response?.data?.error || err.message));
    };

    const results = backtest?.results;
    const variants = results ? Object.entries(results.variants) : [];

    return (
        <Stack spacing={3}>
            {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4, border: "1px solid rgba(15, 61, 62, 0.12)" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>Strategy Backtest (5-min candles)</Typography>
                        <Typography sx={{ color: "#475569", fontSize: 14 }}>
                            Gap reversal (ORB) and closingTwoEngulfe on the 100 most liquid F&O stocks, 2 years, after Zerodha charges and slippage.
                        </Typography>
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
                            {backtest.stage === "download" ? "Downloading candles from Kite (about 5 minutes the first time)..." : "Running backtest..."}
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
                                        <TableCell>Net by year</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {variants.map(([name, s]) => (
                                        <TableRow key={name}>
                                            <TableCell sx={{ fontWeight: 600 }}>{name}</TableCell>
                                            <TableCell align="right">{s.trades}</TableCell>
                                            <TableCell align="right">{s.winRate ?? "-"}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.avgR) }}>{s.avgR ?? "-"}</TableCell>
                                            <TableCell align="right" sx={{ color: pnlColor(s.netPnl), fontWeight: 700 }}>{rupees(s.netPnl)}</TableCell>
                                            <TableCell align="right">{rupees(s.totalCharges)}</TableCell>
                                            <TableCell align="right">{s.profitFactor ?? "-"}</TableCell>
                                            <TableCell align="right">{rupees(s.maxDrawdown)}</TableCell>
                                            <TableCell sx={{ fontSize: 12 }}>
                                                {s.netByYear ? Object.entries(s.netByYear).map(([y, v]) => `${y}: ${rupees(v)}`).join(" · ") : "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Typography sx={{ fontSize: 12, color: "#64748b", mt: 1 }}>
                            Avg R above 0 and profit factor above 1.2 in both years is the minimum before trusting a strategy. Past results do not guarantee future profit.
                        </Typography>
                    </Box>
                )}
            </Paper>

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4, border: "1px solid rgba(15, 61, 62, 0.12)" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
                    <Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="h6" sx={{ fontWeight: 800 }}>Auto Trader</Typography>
                            {trader && (
                                <Chip
                                    size="small"
                                    label={trader.mode === "live" ? "LIVE - real orders" : "PAPER - no real orders"}
                                    color={trader.mode === "live" ? "error" : "default"}
                                />
                            )}
                            {trader && <Chip size="small" label={trader.enabled ? "Running" : "Stopped"} color={trader.enabled ? "success" : "default"} />}
                        </Stack>
                        <Typography sx={{ color: "#475569", fontSize: 14 }}>
                            Methods: gap-up SELL, gap-down BUY, closingTwoEngulfe · balance split in {trader?.settings?.slots} parts
                            {trader?.slotCapital ? ` (${rupees(Math.round(trader.slotCapital))} each)` : ""} · volume ≥ {trader?.settings?.volumeMultiple}x
                            last-10 average · stop loss {trader?.settings?.useStopLoss ? "on" : "off"} · exit by 15:15
                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Button
                            variant="outlined"
                            color={trader?.mode === "live" ? "inherit" : "error"}
                            disabled={!trader}
                            onClick={() => {
                                if (trader.mode === "live") {
                                    call("autotrader/mode", { mode: "paper" });
                                } else if (
                                    window.prompt(
                                        "LIVE mode places REAL orders with your money, with NO stop loss.\nType LIVE to confirm:"
                                    ) === "LIVE"
                                ) {
                                    call("autotrader/mode", { mode: "live", confirm: "LIVE" });
                                }
                            }}
                        >
                            {trader?.mode === "live" ? "Switch to Paper" : "Switch to LIVE"}
                        </Button>
                        <Button variant="contained" color="success" disabled={!trader || trader.enabled} onClick={() => call("autotrader/start")}>
                            Start
                        </Button>
                        <Button variant="outlined" disabled={!trader?.enabled} onClick={() => call("autotrader/stop")}>
                            Stop
                        </Button>
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => window.confirm("Close all auto-trader positions now?") && call("autotrader/square-off")}
                        >
                            Square-off all
                        </Button>
                    </Stack>
                </Stack>

                {trader && (
                    <Box sx={{ mt: 2 }}>
                        <Typography sx={{ fontWeight: 700, color: pnlColor(trader.realisedPnl) }}>
                            Today's realised P&L: {rupees(trader.realisedPnl)}
                        </Typography>
                        {trader.haltedReason && <Alert severity="warning" sx={{ mt: 1 }}>{trader.haltedReason}</Alert>}
                        {trader.lastError && <Alert severity="error" sx={{ mt: 1 }}>{trader.lastError}</Alert>}

                        {trader.positions?.length > 0 && (
                            <TableContainer sx={{ mt: 1 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Stock</TableCell>
                                            <TableCell>Strategy</TableCell>
                                            <TableCell>Side</TableCell>
                                            <TableCell align="right">Qty</TableCell>
                                            <TableCell align="right">Entry</TableCell>
                                            <TableCell align="right">Stop</TableCell>
                                            <TableCell align="right">Target</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell align="right">P&L</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {trader.positions.map((p) => (
                                            <TableRow key={p.id}>
                                                <TableCell sx={{ fontWeight: 600 }}>{p.symbol}</TableCell>
                                                <TableCell>{p.strategy}</TableCell>
                                                <TableCell>{p.side === "long" ? "BUY" : "SELL"}</TableCell>
                                                <TableCell align="right">{p.qty}</TableCell>
                                                <TableCell align="right">{p.entry}</TableCell>
                                                <TableCell align="right">{p.stop}</TableCell>
                                                <TableCell align="right">{p.target}</TableCell>
                                                <TableCell>{p.status}{p.exitReason ? ` (${p.exitReason})` : ""}</TableCell>
                                                <TableCell align="right" sx={{ color: pnlColor(p.pnl) }}>{p.pnl != null ? rupees(p.pnl) : "-"}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}

                        {trader.recentEvents?.length > 0 && (
                            <Box
                                component="pre"
                                sx={{ mt: 2, p: 1.5, maxHeight: 160, overflow: "auto", fontSize: 12, background: "#0f172a", color: "#e2e8f0", borderRadius: 2 }}
                            >
                                {trader.recentEvents.join("\n")}
                            </Box>
                        )}
                    </Box>
                )}
            </Paper>
        </Stack>
    );
};

export default BacktestPanel;
