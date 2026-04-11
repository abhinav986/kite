# Kite Scanner

This app now has:

- a React frontend on `http://localhost:8080`
- a Node backend on `http://localhost:5000`
- frontend requests proxied from `/api/*` to the backend

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `KITE_API_KEY` and `KITE_API_SECRET`.
3. Set `KITE_REDIRECT_URL` to your backend callback URL.
4. Set `FRONTEND_URL` to your frontend URL.
5. Optional:
   - set `KITE_ACCESS_TOKEN` if you already have one
   - set `KITE_REFRESH_TOKEN` if you already have one
   - set `REACT_APP_API_BASE_URL` when frontend and backend are deployed to different origins

## Run

In two terminals:

```bash
npm run server
```

```bash
npm start
```

The frontend already proxies `/api/*` to `localhost:5000`, so no frontend changes are needed for local development.

## Production Auth Flow

For deployment, do not keep rotating `KITE_REQUEST_TOKEN` manually in `.env`.

Use this flow instead:

1. Register your redirect URL in Kite as `https://your-backend-domain/api/auth/callback`
2. Open `GET /api/auth/login`
3. Login to Kite
4. Kite redirects to `/api/auth/callback`
5. The backend exchanges the short-lived `request_token`
6. The backend stores `access_token` and `refresh_token` in `.kite-session.json`
7. Later restarts use the saved `refresh_token` to renew automatically

Useful auth routes:

- `GET /api/auth/status`
- `GET /api/auth/login`
- `GET /api/auth/login-url`
- `GET /api/auth/callback`
- `POST /api/auth/logout`

## Main API Routes

The existing frontend uses these routes:

- `GET /api/instruments`
- `GET /api/historyData?id=<instrument_token>`
- `GET /api/historyData/intraday?id=<instrument_token>`

Additional backend routes are available for the Kite sample workflow:

- `GET /api/health`
- `GET /api/auth/status`
- `GET /api/auth/login`
- `GET /api/auth/login-url`
- `GET /api/auth/callback`
- `POST /api/auth/logout`
- `GET /api/profile`
- `GET /api/margins?segment=equity`
- `GET /api/positions`
- `POST /api/positions/convert`
- `GET /api/holdings`
- `GET /api/orders/:orderId/history`
- `GET /api/trades`
- `GET /api/orders/:orderId/trades`
- `GET /api/quote?i=NSE:RELIANCE&i=NSE:SBIN`
- `GET /api/ohlc?i=NSE:RELIANCE&i=NSE:SBIN`
- `GET /api/ltp?i=NSE:RELIANCE&i=NSE:SBIN`
- `POST /api/orders`
- `PUT /api/orders/:orderId`
- `DELETE /api/orders/:orderId?variety=regular`
- `GET /api/gtts`
- `GET /api/gtts/:triggerId`
- `POST /api/gtts`
- `PUT /api/gtts/:triggerId`
- `DELETE /api/gtts/:triggerId`
- `POST /api/order-margins`
- `POST /api/basket-margins`
- `POST /api/virtual-contract-note`

## Notes

- The backend uses Node's built-in `http` module, so no extra server dependency was needed.
- Instrument responses are cached for 15 minutes to reduce repeated Kite API calls.
- `.env` is now ignored by git so API secrets stay local.
- `.kite-session.json` stores the renewable session locally and is git-ignored.
- `render.yaml` is included as a starting point for Render deployment, but you must update the final domain values after creating your services.
