import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { get } from "./utils/axios";
import ScannerHome from "./scanner/scannerHome";
import AnalyticsHome from "./analysis/analysisHome";
import { stocks80To100_2, stocks80To100, stocks75To80, stocks70To75, stocks65To70, stocks70To75_2 } from "./constants/stock";

const Listing = () => {
    const [data, setData] = useState([]);
    const [showScanner, setShowScanner] = useState(true);
    const [selectedStock, setSelectedStock] = useState(null);

    useEffect(() => {
        get("instruments").then((res) => {
            let filterData = res.data.filter((val) => val.segment === "NSE" && val.instrument_type === "EQ" && val.name);
            filterData = filterData.map((val) => ({ ...val, id: val.instrument_token }));
            setData(filterData);
        });
    }, []);

    useEffect(() => {
        let s65To70 = stocks65To70;
        let s70To75 = stocks70To75;
        let s75To80 = stocks75To80;
        let s80To100 = stocks80To100;
        let s80To100_2 = stocks80To100_2;
        let s70To75_2 = stocks70To75_2;
        s65To70 = s65To70.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s70To75 = s70To75.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s70To75_2 = s70To75_2.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s75To80 = s75To80.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s80To100 = s80To100.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s80To100_2 = s80To100_2.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        localStorage.setItem("stockNames", JSON.stringify({
            stocks65To70: s65To70,
            stocks70To75: s70To75,
            stocks75To80: s75To80,
            stocks80To100: s80To100,
            stocks80To100_2: s80To100_2,
            stocks70To75_2: s70To75_2,
        }));
    }, [data]);

    const columns = useMemo(() => [
        {
            field: "instrument_token",
            headerName: "Token",
            type: "number",
            width: 150,
        },
        {
            field: "name",
            headerName: "Name",
            width: 320,
            renderCell: (params) => (
                <Button
                    variant="text"
                    onClick={() => setSelectedStock({
                        instrumentToken: params.row.instrument_token,
                        name: params.row.name,
                    })}
                    sx={{
                        p: 0,
                        minWidth: 0,
                        justifyContent: "flex-start",
                        textTransform: "none",
                        fontWeight: 700,
                    }}
                >
                    {params.row.name}
                </Button>
            ),
        },
    ], []);

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
                    maxWidth: 1440,
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
                                label="One Page Workspace"
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
                                Instruments, scanner, and history analysis in one page.
                            </Typography>
                            <Typography
                                sx={{
                                    mt: 2,
                                    maxWidth: 700,
                                    color: "#475569",
                                    fontSize: "1rem",
                                }}
                            >
                                Use the buttons to show or hide the scanner, and click any stock name to open its past engulfe analysis below without leaving the home page.
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
                                Controls
                            </Typography>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
                                <Button
                                    variant="contained"
                                    onClick={() => setShowScanner((value) => !value)}
                                    sx={{
                                        backgroundColor: "#f8fafc",
                                        color: "#0f3d3e",
                                        fontWeight: 700,
                                        "&:hover": { backgroundColor: "#e2e8f0" },
                                    }}
                                >
                                    {showScanner ? "Hide Scanner" : "Show Scanner"}
                                </Button>
                                <Button
                                    variant="outlined"
                                    onClick={() => setSelectedStock(null)}
                                    disabled={!selectedStock}
                                    sx={{
                                        borderColor: "rgba(255,255,255,0.35)",
                                        color: "#fff",
                                        fontWeight: 700,
                                    }}
                                >
                                    Hide Analysis
                                </Button>
                            </Stack>
                            <Typography sx={{ mt: 2, opacity: 0.8, fontSize: 14 }}>
                                {selectedStock ? `Selected: ${selectedStock.name}` : "No stock selected yet."}
                            </Typography>
                        </Paper>
                    </Box>

                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                            gap: 3,
                            alignItems: "stretch",
                        }}
                    >
                        <Paper
                            elevation={0}
                            sx={{
                                p: 2,
                                borderRadius: 5,
                                border: "1px solid rgba(15, 23, 42, 0.06)",
                                background: "rgba(255,255,255,0.9)",
                                minWidth: 0,
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
                                        All Instruments
                                    </Typography>
                                    <Typography sx={{ color: "#64748b" }}>
                                        Click a stock name to show its past history analysis in this same page.
                                    </Typography>
                                </Box>
                            </Stack>

                            <Box sx={{ height: 620, width: "100%", minWidth: 0 }}>
                                <DataGrid
                                    rows={data}
                                    columns={columns}
                                    disableRowSelectionOnClick
                                    initialState={{
                                        pagination: {
                                            paginationModel: { page: 0, pageSize: 50 },
                                        },
                                    }}
                                    pageSizeOptions={[25, 50, 100]}
                                />
                            </Box>
                        </Paper>

                        <Box sx={{ minWidth: 0 }}>
                            {selectedStock ? (
                                <AnalyticsHome
                                    instrumentToken={selectedStock.instrumentToken}
                                    stockName={selectedStock.name}
                                    embedded
                                    onClose={() => setSelectedStock(null)}
                                />
                            ) : (
                                <Paper
                                    elevation={0}
                                    sx={{
                                        p: { xs: 2, md: 3 },
                                        borderRadius: 5,
                                        border: "1px solid rgba(15, 61, 62, 0.08)",
                                        background: "rgba(255,255,255,0.9)",
                                        boxShadow: "0 24px 60px rgba(15, 61, 62, 0.08)",
                                        minHeight: { xs: 280, lg: 620 },
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                    }}
                                >
                                    <Chip
                                        label="History Analysis"
                                        sx={{
                                            alignSelf: "flex-start",
                                            mb: 2,
                                            fontWeight: 800,
                                            color: "#0f3d3e",
                                            backgroundColor: "rgba(15, 61, 62, 0.08)",
                                        }}
                                    />
                                    <Typography
                                        variant="h4"
                                        sx={{
                                            fontSize: { xs: "1.8rem", md: "2.2rem" },
                                            lineHeight: 1.05,
                                            color: "#0f172a",
                                            fontWeight: 800,
                                            letterSpacing: "-0.04em",
                                        }}
                                    >
                                        Pick an instrument to analyze.
                                    </Typography>
                                    <Typography sx={{ mt: 1.5, maxWidth: 520, color: "#64748b" }}>
                                        Click any stock name from the left to load its past 2 months of 5-minute engulfe analysis here.
                                    </Typography>
                                </Paper>
                            )}
                        </Box>
                    </Box>

                    {showScanner ? (
                        <ScannerHome
                            embedded
                            onSelectStock={(stock) => setSelectedStock(stock)}
                        />
                    ) : null}
                </Stack>
            </Paper>
        </Box>
    );
};

export default Listing;
