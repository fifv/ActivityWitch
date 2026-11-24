# ActivityWitch

A local, read-only ActivityWatch timeline built with TypeScript, Vite, Canvas 2D, and a Web Worker. Week is the initial view. Choose a device and week, then select a day for its individual watcher timelines.

## Run

Use Node.js 22.18 or newer and start ActivityWatch.

```sh
npm install
npm run dev
```

Open [ActivityWitch on localhost](http://localhost:5177/). The browser sends GET requests directly to `http://127.0.0.1:5600/api/0`. Dev and production preview use the same fixed UI origin.

```sh
npm test
npm run build
npm run preview
```

Stop the dev server before starting preview on port 5177. The built `dist/` directory can also be served by a local static HTTP server. Set `VITE_AW_API_BASE` in `.env.local` and restart Vite or rebuild to use another ActivityWatch API address.

## Origin settings

The ActivityWatch Rust server detected on this machine already accepts `http://localhost:5177`. Use that exact spelling in the address bar. A different hostname or port is a different browser origin.

For another Rust installation, open `%LOCALAPPDATA%\activitywatch\aw-server-rust\config.toml` on Windows. Add the UI origin to the existing top-level `cors` array, keeping existing entries. If the key is absent, add it above any table headers.

```toml
cors = ["http://localhost:5177"]
```

Restart ActivityWatch after a config change, then refresh the UI. The Python server uses `cors_origins` under `[server]` in `aw-server.toml`. An allowed origin receives normal API access. This application's own requests are read-only. [ActivityWatch configuration](https://docs.activitywatch.net/en/latest/configuration.html) · [ActivityWatch security](https://docs.activitywatch.net/en/latest/security.html)

## Reading the timeline

- **Week map** aligns Monday through Sunday by local clock time. Each 15-minute block shows the label with the longest recorded duration for the selected watcher. The lower strip shows the active/away split among recorded presence events. Hover for the interval and select a day for exact records. Gray gaps indicate missing observations.
- **Day map** puts all watchers on the same axis. Drag to zoom, select a block for details, or use the event stream from the keyboard. The summary, usage ranking, and stream follow the zoomed interval.
- **Active and away** come from the presence watcher. A dash indicates missing presence records. Application usage totals foreground-window duration, including time a window remained open while away. Percentages use total recorded window time.
- **Event log** searches the whole selected day or week. Source filters and application rows narrow the stream. Arrow keys, Home, and End move between focused rows. Event details include the recorded data and the time span inside the loaded period.
- **Preferences** for device, period, date, tab, map mode, watcher, and search filters are saved in this browser. Selecting the current day or week via Today/This week follows the current date on the next visit.

## Weekly performance and storage

Bucket reads run in parallel. Consecutive missing days share a range request per watcher, plus one preceding event for sessions crossing the period boundary. The worker normalizes, sorts, and aggregates records off the UI thread. Midnight-spanning records count once in weekly totals. The week map uses 96 time blocks per day. The browser receives the summary and only the visible rows of the weekly event log.

IndexedDB keeps up to 21 device-day snapshots on the local browser profile, including event details. Six recent weekly overviews are cached separately so the map can appear while the event list loads. Completed days are reused for up to 24 hours and the current day for 30 seconds. Refresh explicitly rereads the selected period, including subsequently synced historical records. Clear this site's browser storage to remove cached events and preferences. Browser storage failures fall back to live reads.

## Source layout

- `src/data/` contains ActivityWatch reads, the worker, date and interval handling, aggregation, and cache storage.
- `src/ui/` contains the day and week renderers, virtual event list, and icons.
- `src/main.ts` binds navigation, filters, selection, and connection state.
- `tests/` checks time boundaries, aggregation, and daylight-saving transitions.

