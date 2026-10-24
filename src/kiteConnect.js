import React, { useCallback, useEffect, useState } from "react";
import { Button, Chip, Stack } from "@mui/material";
import { basePath, get, post } from "./utils/axios";

// Kite login status + Connect button. The status is checked by fetching the Kite profile, so an expired
// token shows as "Not connected" (a stored token alone doesn't mean the session still works).
const KiteConnect = () => {
    const [state, setState] = useState({ checking: true, connected: false, user: "" });

    const check = useCallback(() => {
        setState((s) => ({ ...s, checking: true }));
        get("profile")
            .then((res) => setState({ checking: false, connected: true, user: res.data?.user_name || res.data?.user_id || "" }))
            .catch(() => setState({ checking: false, connected: false, user: "" }));
    }, []);

    useEffect(() => {
        check();
        // re-check when coming back to the tab after logging in on Kite
        window.addEventListener("focus", check);
        return () => window.removeEventListener("focus", check);
    }, [check]);

    const connect = () => window.location.assign(`${basePath}auth/login`);
    const disconnect = () => post("auth/logout", {}).finally(check);

    const chipLabel = state.checking ? "Kite: checking..." : state.connected ? `Kite connected${state.user ? ` · ${state.user}` : ""}` : "Kite not connected";

    return (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <Chip
                label={chipLabel}
                sx={{
                    fontWeight: 800,
                    color: state.connected ? "#14532d" : "#78350f",
                    backgroundColor: state.connected ? "#bbf7d0" : "#fde68a",
                }}
            />
            <Button
                variant="contained"
                onClick={connect}
                sx={{
                    backgroundColor: state.connected ? "rgba(255,255,255,0.16)" : "#f8fafc",
                    color: state.connected ? "#fff" : "#0f3d3e",
                    fontWeight: 800,
                    "&:hover": { backgroundColor: state.connected ? "rgba(255,255,255,0.24)" : "#e2e8f0" },
                }}
            >
                {state.connected ? "Reconnect Kite" : "Connect Kite"}
            </Button>
            {state.connected && (
                <Button variant="text" onClick={disconnect} sx={{ color: "rgba(255,255,255,0.8)", fontWeight: 700 }}>
                    Disconnect
                </Button>
            )}
        </Stack>
    );
};

export default KiteConnect;
