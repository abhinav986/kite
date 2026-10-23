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
    TextField,
    Typography,
} from "@mui/material";
import { get, post } from "../utils/axios";

const price = (value) =>
    value == null ? "-" : `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pnlColor = (value) => (value > 0 ? "#15803d" : value < 0 ? "#b91c1c" : "inherit");

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const timeIST = (date) => new Date(date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

// when the gap break window closes: 9:25 for 1 candle after 9:15, 9:35 for 3
const breakEndLabel = (settings) => {
    const minute = 9 * 60 + 20 + 5 * Math.max(1, settings?.orbBreakCandles || 1);
    return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
};

const statusText = (p) => {
    if (p.status === "open") return "open · exit by 15:15";
    if (p.exitReason === "stop") return "stop hit";
    if (p.exitReason === "target") return "target hit";
    return "exited 15:15";
};

// Telegram signal alerts + paper results. Today's data comes from the running scanner; any other date is
// scanned on the server in the background and polled here.
const SignalsPanel = () => {
    const [trader, setTrader] = useState(null);
    const [date, setDate] = useState(istToday());
    const [dateResult, setDateResult] = useState(null);
    const [error, setError] = useState("");
    const isToday = date === istToday();

    const refreshStatus = useCallback(() => {
        get("autotrader/status").then((res) => setTrader(res.data)).catch(() => {});
    }, []);

    useEffect(() => {
        refreshStatus();
        const interval = setInterval(refreshStatus, trader?.enabled ? 5000 : 15000);
        return () => clearInterval(interval);
    }, [refreshStatus, trader?.enabled]);

    useEffect(() => {
        if (isToday) {
            setDateResult(null);
            return undefined;
        }
        let cancelled = false;
        let timer;
        setDateResult({ status: "running", progress: "0" });
        const load = () =>
            get(`autotrader/signals?date=${date}`)
                .then((res) => {
                    if (cancelled) return;
                    setDateResult(res.data);
                    if (res.data.status === "running") timer = setTimeout(load, 2000);
                })
                .catch((err) => {
                    if (!cancelled) setDateResult({ status: "error", error: err?.response?.data?.error || err.message });
                });
        load();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [date, isToday]);

    const call = (url, payload) => {
        setError("");
        return post(url, payload)
            .then(refreshStatus)
            .catch((err) => setError(err?.response?.data?.error || err.message));
    };

    const settings = trader?.settings;
    const positions = isToday ? (trader?.paperSessionDay === date ? trader.positions || [] : []) : dateResult?.positions || [];
    const scanning = isToday ? Boolean(trader?.replayProgress) : dateResult?.status === "running";
    const progress = isToday ? trader?.replayProgress : dateResult?.progress;
    const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const watchlist = isToday ? trader?.orbCandidates || [] : [];

    return (
        <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4, border: "1px solid rgba(15, 61, 62, 0.12)" }}>
            {error && <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>{error}</Alert>}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
                <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>Signals & Paper Trades</Typography>
                        {trader && <Chip size="small" label={trader.enabled ? "Scanning" : "Stopped"} color={trader.enabled ? "success" : "default"} />}
                        {trader && (
                            <Chip
                                size="small"
                                label={trader.telegramConfigured ? "Telegram alerts on" : "Telegram not set up"}
                                color={trader.telegramConfigured ? "info" : "warning"}
                            />
                        )}
                        {trader?.mode === "live" && <Chip size="small" color="error" label="LIVE - real orders" />}
                    </Stack>
                    {settings && (
                        <Typography sx={{ color: "#475569", fontSize: 14 }}>
                            Gap ≥ {settings.orbMinGapPct}% fade: gap-up → SELL below the 1st 5-min candle's low, gap-down → BUY above its high
                            (break before {breakEndLabel(settings)}){settings.niftyFilter ? `, Nifty not more than ${settings.niftyMaxAgainstPct}% with the gap` : ""} ·
                            stop at the 1st candle's other end · exit by 15:15
                        </Typography>
                    )}
                </Box>
                <Stack direction="row" spacing={1}>
                    <Button variant="contained" color="success" disabled={!trader || trader.enabled} onClick={() => call("autotrader/start")}>
                        Start
                    </Button>
                    <Button variant="outlined" disabled={!trader?.enabled} onClick={() => call("autotrader/stop")}>
                        Stop
                    </Button>
                    {trader?.mode === "live" && (
                        <Button variant="outlined" color="error" onClick={() => call("autotrader/mode", { mode: "paper" })}>
                            Switch to Paper
                        </Button>
                    )}
                </Stack>
            </Stack>

            {trader && !trader.enabled && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Click Start: it checks today's data right away and alerts you on Telegram for any match, then keeps scanning every 5 minutes
                    during market hours - a 9:20 watchlist with the exact trigger prices, a confirmed BUY/SELL signal, and the exit (stop or 15:15).
                    No orders are placed.
                </Alert>
            )}

            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
                <TextField
                    type="date"
                    size="small"
                    label="Date"
                    value={date}
                    onChange={(event) => event.target.value && setDate(event.target.value)}
                    inputProps={{ max: istToday() }}
                    InputLabelProps={{ shrink: true }}
                />
                <Button size="small" disabled={isToday} onClick={() => setDate(istToday())}>
                    Today
                </Button>
                <Typography sx={{ fontWeight: 700, color: pnlColor(totalPnl) }}>
                    {positions.length} signal{positions.length === 1 ? "" : "s"} · paper P&L {price(Math.round(totalPnl))}
                </Typography>
            </Stack>

            {scanning && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography sx={{ fontSize: 13 }}>Scanning stocks {progress}...</Typography>
                    <LinearProgress />
                </Box>
            )}
            {!isToday && dateResult?.note && <Alert severity="info" sx={{ mt: 1.5 }}>{dateResult.note}</Alert>}
            {!isToday && dateResult?.status === "error" && <Alert severity="error" sx={{ mt: 1.5 }}>{dateResult.error}</Alert>}
            {isToday && trader?.lastError && <Alert severity="error" sx={{ mt: 1.5 }}>{trader.lastError}</Alert>}

            {watchlist.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>
                        9:20 watchlist - trades only if the level breaks before {breakEndLabel(settings)} without hitting the stop first
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {watchlist.map((c) => (
                            <Chip
                                key={c.symbol}
                                variant="outlined"
                                color={c.side === "short" ? "error" : "success"}
                                label={`${c.side === "short" ? "SELL" : "BUY"} ${c.symbol} ${c.side === "short" ? "below" : "above"} ${price(c.level)} · stop ${price(
                                    c.stopLevel
                                )} · gap ${c.gapPct > 0 ? "+" : ""}${c.gapPct.toFixed(2)}%`}
                            />
                        ))}
                    </Stack>
                </Box>
            )}

            {positions.length > 0 ? (
                <TableContainer sx={{ mt: 2 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Time</TableCell>
                                <TableCell>Stock</TableCell>
                                <TableCell>Signal</TableCell>
                                <TableCell align="right">Entry price</TableCell>
                                <TableCell align="right">Stop</TableCell>
                                <TableCell align="right">Exit / Last</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell align="right">Qty</TableCell>
                                <TableCell align="right">Paper P&L</TableCell>
                                <TableCell>Why</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {positions.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell>{timeIST(p.time)}</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>{p.symbol}</TableCell>
                                    <TableCell>
                                        <Chip size="small" label={p.side === "long" ? "BUY" : "SELL"} color={p.side === "long" ? "success" : "error"} />
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700 }}>{price(p.entry)}</TableCell>
                                    <TableCell align="right">{price(p.stop)}</TableCell>
                                    <TableCell align="right">{price(p.exit ?? p.lastPrice)}</TableCell>
                                    <TableCell>{statusText(p)}</TableCell>
                                    <TableCell align="right">{p.qty}</TableCell>
                                    <TableCell align="right" sx={{ color: pnlColor(p.pnl), fontWeight: 700 }}>{price(p.pnl)}</TableCell>
                                    <TableCell sx={{ fontSize: 12, color: "#64748b" }}>{p.reason}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            ) : (
                !scanning && (
                    <Typography sx={{ mt: 2, color: "#64748b", fontSize: 14 }}>
                        {isToday && !trader?.enabled ? "Not scanned yet - click Start." : "No stock matched the conditions on this date."}
                    </Typography>
                )
            )}

            {isToday && trader?.recentEvents?.length > 0 && (
                <Box
                    component="pre"
                    sx={{ mt: 2, p: 1.5, maxHeight: 160, overflow: "auto", fontSize: 12, background: "#0f172a", color: "#e2e8f0", borderRadius: 2 }}
                >
                    {trader.recentEvents.join("\n")}
                </Box>
            )}
        </Paper>
    );
};

export default SignalsPanel;
