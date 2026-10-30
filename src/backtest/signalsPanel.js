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
    ToggleButton,
    ToggleButtonGroup,
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

const STRATEGY_KEYS = ["gap", "pullback", "swing"];
const STRATEGY_COLORS = { gap: "#2563eb", pullback: "#7c3aed", swing: "#0f766e" };

const statusText = (p) => {
    if (p.strategyKey === "swing") {
        if (p.provisional) return "buy at today's close";
        return p.status === "closed" ? `sold day 15 (${p.exitDay})` : `holding day ${p.holdDay}/15`;
    }
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
    const [strategyFilter, setStrategyFilter] = useState("all");
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
    const strategyInfo = trader?.strategyInfo || {};
    const active = new Set(trader?.activeStrategies || []);
    const allPositions = isToday ? (trader?.paperSessionDay === date ? trader.positions || [] : []) : dateResult?.positions || [];
    const positions = strategyFilter === "all" ? allPositions : allPositions.filter((p) => p.strategyKey === strategyFilter);
    const countFor = (key) => allPositions.filter((p) => p.strategyKey === key).length;
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
                    <Typography sx={{ color: "#475569", fontSize: 14 }}>
                        Start each strategy on its own. Paper only: signals and Telegram alerts, no orders.
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                    {trader?.mode === "live" && (
                        <Button variant="outlined" color="error" onClick={() => call("autotrader/mode", { mode: "paper" })}>
                            Switch to Paper
                        </Button>
                    )}
                </Stack>
            </Stack>

            {trader && (
                <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
                    {STRATEGY_KEYS.map((key) => {
                        const info = strategyInfo[key];
                        if (!info) return null;
                        const running = active.has(key);
                        const liveBlocked = trader.mode === "live" && key !== "gap";
                        return (
                            <Paper
                                key={key}
                                elevation={0}
                                sx={{
                                    p: 2,
                                    borderRadius: 3,
                                    border: `1px solid ${running ? "rgba(21,128,61,0.45)" : "rgba(15,23,42,0.1)"}`,
                                    background: running ? "rgba(21,128,61,0.04)" : "#fff",
                                    display: "flex",
                                    flexDirection: "column",
                                }}
                            >
                                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                    <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{info.label}</Typography>
                                    <Chip size="small" label={running ? "Running" : "Stopped"} color={running ? "success" : "default"} />
                                </Stack>
                                <Typography sx={{ fontSize: 12, fontWeight: 700, color: STRATEGY_COLORS[key], mt: 0.25 }}>{info.type}</Typography>
                                <Box component="ul" sx={{ pl: 2.25, my: 1, flex: 1 }}>
                                    {info.rules.map((rule) => (
                                        <Typography component="li" key={rule} sx={{ fontSize: 12.5, color: "#475569", mb: 0.4 }}>
                                            {rule}
                                        </Typography>
                                    ))}
                                </Box>
                                <Button
                                    variant={running ? "outlined" : "contained"}
                                    color={running ? "inherit" : "success"}
                                    disabled={liveBlocked}
                                    onClick={() => call(running ? "autotrader/stop" : "autotrader/start", { strategy: key })}
                                    sx={{ fontWeight: 800 }}
                                >
                                    {liveBlocked ? "Paper mode only" : running ? `Stop ${info.label}` : `Start ${info.label}`}
                                </Button>
                            </Paper>
                        );
                    })}
                </Box>
            )}

            {trader && !trader.enabled && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Start a strategy: it checks today's data right away and alerts you on Telegram for any match, then keeps scanning every 5 minutes
                    during market hours. Gap strategies alert the entry and the exit (stop or 15:15); the swing alerts the buy (at the day's close) and the
                    sell after 15 trading days. No orders are placed.
                </Alert>
            )}

            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
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
                <ToggleButtonGroup size="small" exclusive value={strategyFilter} onChange={(_, v) => v && setStrategyFilter(v)}>
                    <ToggleButton value="all" sx={{ textTransform: "none", fontWeight: 700 }}>
                        All ({allPositions.length})
                    </ToggleButton>
                    {STRATEGY_KEYS.map((key) => (
                        <ToggleButton key={key} value={key} sx={{ textTransform: "none", fontWeight: 700 }}>
                            {strategyInfo[key]?.label || key} ({countFor(key)})
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
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
                                <TableCell>Strategy</TableCell>
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
                                    <TableCell>{p.strategyKey === "swing" && p.entryDay !== p.day ? `${p.entryDay} close` : timeIST(p.time)}</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>{p.symbol}</TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            label={strategyInfo[p.strategyKey]?.label || p.strategy}
                                            sx={{ fontWeight: 700, color: STRATEGY_COLORS[p.strategyKey], borderColor: STRATEGY_COLORS[p.strategyKey] }}
                                        />
                                    </TableCell>
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
