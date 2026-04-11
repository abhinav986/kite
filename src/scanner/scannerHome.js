import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { basePath, get, post } from "../utils/axios";
import { engulfe } from "../utils/analysis";

const SCANNER_OPTIONS = [
    { id: "1", key: "stocks65To70", label: "Scanner 1", description: "65 to 70 range" },
    { id: "2", key: "stocks70To75", label: "Scanner 2", description: "70 to 75 range" },
    { id: "3", key: "stocks75To80", label: "Scanner 3", description: "75 to 80 range" },
    { id: "4", key: "stocks80To100", label: "Scanner 4", description: "80 to 100 range" },
    { id: "5", key: "stocks80To100_2", label: "Scanner 5", description: "80 to 100 alt set" },
    { id: "6", key: "stocks70To75_2", label: "Scanner 6", description: "70 to 75 alt set" },
];

const columns = [
    {
        field: "name",
        headerName: "Stock",
        flex: 1.1,
        minWidth: 180,
        renderCell: (params) => (
            <span
                style={{
                    color: "#0f3d3e",
                    fontWeight: 700,
                }}
            >
                {params.row.name}
            </span>
        ),
    },
    {
        field: "buyOrSellPrice",
        headerName: "Buy/Sell",
        minWidth: 120,
        renderCell: (params) => (
            <span style={{ color: "#1e293b", fontWeight: 700 }}>
                {params.value == null ? "-" : params.value}
            </span>
        ),
    },
    {
        field: "hit",
        headerName: "Hit",
        minWidth: 110,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value ? "Yes" : "No"}
                sx={{
                    fontWeight: 700,
                    backgroundColor: params.value ? "rgba(16, 185, 129, 0.16)" : "rgba(148, 163, 184, 0.18)",
                    color: params.value ? "#047857" : "#475569",
                }}
            />
        ),
    },
    {
        field: "inProgress",
        headerName: "Status",
        minWidth: 130,
        renderCell: (params) => (
            <Chip
                size="small"
                label={params.value ? "Active" : "Waiting"}
                sx={{
                    fontWeight: 700,
                    backgroundColor: params.value ? "rgba(34, 197, 94, 0.14)" : "rgba(148, 163, 184, 0.18)",
                    color: params.value ? "#166534" : "#475569",
                }}
            />
        ),
    },
    {
        field: "profitOrLoss",
        headerName: "Profit",
        minWidth: 120,
        type: "number",
        renderCell: (params) => {
            const positive = Number(params.value || 0) >= 0;
            return (
                <span style={{ color: positive ? "#0f766e" : "#b91c1c", fontWeight: 700 }}>
                    {params.value ?? 0}
                </span>
            );
        },
    },
    {
        field: "direction",
        headerName: "Direction",
        minWidth: 120,
        renderCell: (params) => {
            const isUp = params.value === "up";
            return (
                <Chip
                    size="small"
                    label={params.value || "-"}
                    sx={{
                        textTransform: "capitalize",
                        fontWeight: 700,
                        backgroundColor: isUp ? "rgba(20, 184, 166, 0.14)" : "rgba(245, 158, 11, 0.18)",
                        color: isUp ? "#115e59" : "#92400e",
                    }}
                />
            );
        },
    },
];

const getStoredJson = (key, fallback) => {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        return fallback;
    }
};

const ScannerHome = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [authStatus, setAuthStatus] = useState(null);
    const [authLoading, setAuthLoading] = useState(false);
    const [tracker, setTracker] = useState({
        engulfe: [],
    });

    const scannerId = String(id || "1");
    const stockNames = useMemo(() => getStoredJson("stockNames", {}), []);
    const storageAnalysis = useMemo(() => getStoredJson("analysis", {}), []);
    const currentScanner = SCANNER_OPTIONS.find((option) => option.id === scannerId) || SCANNER_OPTIONS[0];

    const stockList = useMemo(() => {
        return stockNames?.[currentScanner.key] || [];
    }, [currentScanner.key, stockNames]);

    const fetchAuthStatus = async () => {
        setAuthLoading(true);
        try {
            const response = await get("auth/status");
            setAuthStatus(response.data);
        } catch (error) {
            setAuthStatus(null);
        } finally {
            setAuthLoading(false);
        }
    };

    useEffect(() => {
        fetchAuthStatus();
    }, []);

    useEffect(() => {
        let active = true;

        const loadScannerData = async () => {
            const requests = stockList
                .filter((stock) => stock.instrument_token)
                .map((stock) =>
                    get(`historyData/intraday/?id=${stock.instrument_token}`).then((result) => ({
                        name: stock.name,
                        result,
                        instrument_token: stock.instrument_token,
                    }))
                );

            setLoading(true);
            const response = await Promise.allSettled(requests);

            if (!active) {
                return;
            }

            setData(response);
            setLoading(false);
        };

        loadScannerData();

        return () => {
            active = false;
        };
    }, [stockList]);

    useEffect(() => {
        const engulfeArr = [];

        data.forEach((stock) => {
            const candles = stock?.value?.result?.data || [];
            const category = getCategory(stock?.value?.name, storageAnalysis);

            if (!candles.length) {
                return;
            }

            const result = engulfe(candles);
            if ((result.inProgress && result.isSucess && category.includes("Engulfe total")) || category.length === 0) {
                engulfeArr.push({
                    id: engulfeArr.length + 1,
                    name: stock?.value?.name,
                    instrument_token: stock?.value?.instrument_token,
                    ...result,
                });
            }
        });

        setTracker({
            engulfe: engulfeArr,
        });
    }, [data, storageAnalysis]);

    const stats = useMemo(() => {
        const total = tracker.engulfe.length;
        const active = tracker.engulfe.filter((row) => row.inProgress).length;
        const bullish = tracker.engulfe.filter((row) => row.direction === "up").length;
        const totalProfit = tracker.engulfe.reduce((sum, row) => sum + Number(row.profitOrLoss || 0), 0);

        return { total, active, bullish, totalProfit };
    }, [tracker.engulfe]);

    const openKiteLogin = () => {
        window.location.assign(`${basePath}auth/login`);
    };

    const logoutKite = async () => {
        setAuthLoading(true);
        try {
            await post("auth/logout", {});
            await fetchAuthStatus();
        } finally {
            setAuthLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: "100vh",
                background:
                    "radial-gradient(circle at top, rgba(255,226,196,0.75), transparent 26%), linear-gradient(135deg, #fffaf0 0%, #dff3f0 48%, #f9f2df 100%)",
                p: { xs: 2, md: 4 },
            }}
        >
            <Paper
                elevation={0}
                sx={{
                    maxWidth: 1280,
                    mx: "auto",
                    p: { xs: 2, md: 3 },
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(15, 61, 62, 0.08)",
                    boxShadow: "0 24px 60px rgba(15, 61, 62, 0.12)",
                    backdropFilter: "blur(18px)",
                }}
            >
                <Stack spacing={3}>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr", lg: "1.1fr 0.9fr" },
                            gap: 3,
                            alignItems: "start",
                        }}
                    >
                        <Box>
                            <Chip
                                label="Intraday Scanner"
                                sx={{
                                    mb: 2,
                                    fontWeight: 800,
                                    letterSpacing: "0.08em",
                                    color: "#0f3d3e",
                                    backgroundColor: "rgba(15, 61, 62, 0.08)",
                                }}
                            />
                            <Typography
                                variant="h3"
                                sx={{
                                    fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
                                    fontSize: { xs: "2rem", md: "3rem" },
                                    lineHeight: 1,
                                    color: "#0f172a",
                                    fontWeight: 800,
                                    letterSpacing: "-0.04em",
                                }}
                            >
                                Trade signals with a cleaner cockpit.
                            </Typography>
                            <Typography
                                sx={{
                                    mt: 2,
                                    maxWidth: 640,
                                    color: "#475569",
                                    fontSize: "1rem",
                                }}
                            >
                                Switch scanners instantly, track active engulf setups, and jump into stock detail pages without leaving the dashboard.
                            </Typography>
                        </Box>

                        <Paper
                            elevation={0}
                            sx={{
                                p: 2.5,
                                borderRadius: 4,
                                background: "linear-gradient(180deg, rgba(15,61,62,0.96) 0%, rgba(24,102,92,0.94) 100%)",
                                color: "#f8fafc",
                            }}
                        >
                            <Typography sx={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.75 }}>
                                Scanner Control
                            </Typography>
                            <FormControl fullWidth sx={{ mt: 2 }}>
                                <InputLabel id="scanner-select-label" sx={{ color: "rgba(248,250,252,0.76)" }}>
                                    Scanner
                                </InputLabel>
                                <Select
                                    labelId="scanner-select-label"
                                    value={scannerId}
                                    label="Scanner"
                                    onChange={(event) => navigate(`/scannerHome/${event.target.value}`)}
                                    sx={{
                                        color: "#fff",
                                        ".MuiOutlinedInput-notchedOutline": {
                                            borderColor: "rgba(255,255,255,0.3)",
                                        },
                                        "&:hover .MuiOutlinedInput-notchedOutline": {
                                            borderColor: "rgba(255,255,255,0.55)",
                                        },
                                        ".MuiSvgIcon-root": {
                                            color: "#fff",
                                        },
                                    }}
                                >
                                    {SCANNER_OPTIONS.map((option) => (
                                        <MenuItem key={option.id} value={option.id}>
                                            {option.label} - {option.description}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Typography sx={{ mt: 2, fontWeight: 700 }}>
                                {currentScanner.label}
                            </Typography>
                            <Typography sx={{ opacity: 0.76, fontSize: 14 }}>
                                {currentScanner.description}
                            </Typography>
                        </Paper>
                    </Box>

                    <Paper
                        elevation={0}
                        sx={{
                            p: 2.5,
                            borderRadius: 5,
                            border: "1px solid rgba(15, 61, 62, 0.08)",
                            background: "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(240,249,247,0.88) 100%)",
                        }}
                    >
                        <Stack
                            direction={{ xs: "column", md: "row" }}
                            spacing={2}
                            justifyContent="space-between"
                            alignItems={{ xs: "flex-start", md: "center" }}
                        >
                            <Box>
                                <Typography sx={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
                                    Kite Connection
                                </Typography>
                                <Typography sx={{ mt: 0.5, color: "#64748b", maxWidth: 660 }}>
                                    Connect once from the browser, let the backend store the renewable session, and refresh the status here anytime.
                                </Typography>
                            </Box>
                            <Stack direction="row" spacing={1.2} flexWrap="wrap">
                                <Button
                                    variant="contained"
                                    onClick={openKiteLogin}
                                    sx={{
                                        backgroundColor: "#0f766e",
                                        fontWeight: 700,
                                        "&:hover": { backgroundColor: "#115e59" },
                                    }}
                                >
                                    Connect Kite
                                </Button>
                                <Button
                                    variant="outlined"
                                    onClick={fetchAuthStatus}
                                    disabled={authLoading}
                                    sx={{
                                        borderColor: "rgba(15,61,62,0.22)",
                                        color: "#0f3d3e",
                                        fontWeight: 700,
                                    }}
                                >
                                    Refresh Status
                                </Button>
                                <Button
                                    variant="text"
                                    onClick={logoutKite}
                                    disabled={authLoading || !authStatus?.authenticated}
                                    sx={{
                                        color: "#b91c1c",
                                        fontWeight: 700,
                                    }}
                                >
                                    Logout
                                </Button>
                            </Stack>
                        </Stack>

                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>
                            <Chip
                                label={authStatus?.configured ? "Configured" : "Missing config"}
                                sx={{
                                    fontWeight: 700,
                                    backgroundColor: authStatus?.configured ? "rgba(20,184,166,0.14)" : "rgba(239,68,68,0.14)",
                                    color: authStatus?.configured ? "#115e59" : "#b91c1c",
                                }}
                            />
                            <Chip
                                label={authStatus?.authenticated ? "Authenticated" : "Not authenticated"}
                                sx={{
                                    fontWeight: 700,
                                    backgroundColor: authStatus?.authenticated ? "rgba(34,197,94,0.14)" : "rgba(148,163,184,0.18)",
                                    color: authStatus?.authenticated ? "#166534" : "#475569",
                                }}
                            />
                            <Chip
                                label={authStatus?.renewable ? "Auto renew enabled" : "No refresh token"}
                                sx={{
                                    fontWeight: 700,
                                    backgroundColor: authStatus?.renewable ? "rgba(59,130,246,0.14)" : "rgba(245,158,11,0.18)",
                                    color: authStatus?.renewable ? "#1d4ed8" : "#92400e",
                                }}
                            />
                            <Chip
                                label={authStatus?.hasPersistedSession ? "Persisted session found" : "No saved session"}
                                sx={{
                                    fontWeight: 700,
                                    backgroundColor: "rgba(15,23,42,0.06)",
                                    color: "#334155",
                                }}
                            />
                        </Stack>

                        <Typography sx={{ mt: 2, color: "#64748b", fontSize: 14 }}>
                            Callback: {authStatus?.redirectUrl || "Set KITE_REDIRECT_URL in your backend environment"}
                        </Typography>
                    </Paper>

                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" },
                            gap: 2,
                        }}
                    >
                        {[
                            { label: "Stocks Loaded", value: stockList.length, tone: "#0f766e" },
                            { label: "Signals Found", value: stats.total, tone: "#b45309" },
                            { label: "Active Setups", value: stats.active, tone: "#1d4ed8" },
                            { label: "Net Profit", value: stats.totalProfit, tone: stats.totalProfit >= 0 ? "#15803d" : "#b91c1c" },
                        ].map((item) => (
                            <Paper
                                key={item.label}
                                elevation={0}
                                sx={{
                                    p: 2.25,
                                    borderRadius: 4,
                                    border: "1px solid rgba(15, 23, 42, 0.06)",
                                    background: "rgba(255,255,255,0.88)",
                                }}
                            >
                                <Typography sx={{ color: "#64748b", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                    {item.label}
                                </Typography>
                                <Typography sx={{ mt: 0.8, fontSize: 30, fontWeight: 800, color: item.tone }}>
                                    {item.value}
                                </Typography>
                            </Paper>
                        ))}
                    </Box>

                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            borderRadius: 5,
                            border: "1px solid rgba(15, 23, 42, 0.06)",
                            background: "rgba(255,255,255,0.9)",
                        }}
                    >
                        <Stack
                            direction={{ xs: "column", md: "row" }}
                            spacing={1.5}
                            justifyContent="space-between"
                            sx={{ mb: 2 }}
                        >
                            <Box>
                                <Typography sx={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
                                    Engulfe Scanner
                                </Typography>
                                <Typography sx={{ color: "#64748b" }}>
                                    Live filtered results for {currentScanner.label.toLowerCase()}.
                                </Typography>
                            </Box>
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                                <Chip label={`${stats.bullish} bullish`} sx={{ fontWeight: 700, backgroundColor: "rgba(20,184,166,0.14)", color: "#115e59" }} />
                                <Chip label={`${stats.total - stats.bullish} bearish`} sx={{ fontWeight: 700, backgroundColor: "rgba(245,158,11,0.18)", color: "#92400e" }} />
                            </Stack>
                        </Stack>

                        <Box sx={{ height: 540 }}>
                            <DataGrid
                                rows={tracker.engulfe}
                                columns={columns}
                                loading={loading}
                                disableRowSelectionOnClick
                                pageSizeOptions={[10, 25, 50]}
                                initialState={{
                                    pagination: {
                                        paginationModel: { pageSize: 10, page: 0 },
                                    },
                                }}
                                sx={{
                                    border: "none",
                                    "& .MuiDataGrid-columnHeaders": {
                                        backgroundColor: "#f3f7f7",
                                        color: "#0f172a",
                                        fontWeight: 800,
                                        borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
                                    },
                                    "& .MuiDataGrid-row": {
                                        backgroundColor: "rgba(255,255,255,0.78)",
                                    },
                                    "& .MuiDataGrid-row:nth-of-type(even)": {
                                        backgroundColor: "rgba(241,245,249,0.7)",
                                    },
                                    "& .MuiDataGrid-cell": {
                                        borderColor: "rgba(15, 23, 42, 0.06)",
                                    },
                                    "& .MuiDataGrid-footerContainer": {
                                        borderTop: "1px solid rgba(15, 23, 42, 0.06)",
                                    },
                                }}
                            />
                        </Box>
                    </Paper>
                </Stack>
            </Paper>
        </Box>
    );
};

function getCategory(name, storageAnalysis) {
    const data = storageAnalysis?.[name];
    const category = [];

    if (!data) {
        return category;
    }

    Object.keys(data).forEach((key) => {
        if (data[key] >= 50) {
            category.push(key);
        }
    });

    return category;
}

export default ScannerHome;
