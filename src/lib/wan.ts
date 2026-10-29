/**
 * WAN statistics of UniFi Network 11 and newer.
 *
 * Network 11 replaced the statistics engine and cleared the history: `stat/report/daily.gw` returns no data
 * anymore. The dashboard of the network application uses
 * `GET /v2/api/site/<site>/aggregated-dashboard?historySeconds=<s>` instead, which is summarized here.
 */

/** One bucket of the WAN history. Despite the name, the rates are bytes per second (verified against `summary`) */
export interface WanHistoryBucket {
    /** Start of the bucket in ms */
    timestamp: number;
    avg_rx_rate_bps?: number;
    avg_tx_rate_bps?: number;
    avg_latency_ms?: number;
    avg_packet_loss_pct?: number;
}

/** The parts of the aggregated dashboard used by the adapter */
export interface AggregatedDashboard {
    wan_activity?: {
        activity_by_network_group?: Record<string, { history?: WanHistoryBucket[] } | undefined>;
    };
    wan?: {
        wan_details?: {
            network_group?: string;
            network_name?: string;
            isp?: {
                name?: string;
                asn?: number;
                capabilities?: { download_kilobits_per_second?: number; upload_kilobits_per_second?: number };
            };
            stats?: {
                activity?: { 'rx_bytes-r'?: number; 'tx_bytes-r'?: number };
                monthly_bytes?: number;
            };
            status?: { interface_name?: string; up?: boolean; is_active?: boolean };
        }[];
    };
    wan_history?: {
        wan_history_details?: { network_group?: string; uptime?: number }[];
    };
    speed_test?: {
        data?: {
            wan_networkgroup?: string;
            download_mbps?: number;
            upload_mbps?: number;
            latency_ms?: number;
            time?: number;
        }[];
    };
}

/** Values of one WAN connection, the data of admin/lib/objects_wan.json */
export interface WanSummary {
    /** Network group, e.g. `WAN` or `WAN2`, used as object ID */
    id: string;
    name: string | null;
    isp_name: string | null;
    isp_asn: number | null;
    /** Mbit/s */
    capacity_download: number | null;
    /** Mbit/s */
    capacity_upload: number | null;
    up: boolean | null;
    active: boolean | null;
    interface: string | null;
    /** Percent */
    uptime: number | null;
    /** Bytes per second */
    rx_rate: number | null;
    /** Bytes per second */
    tx_rate: number | null;
    today_rx_bytes: number | null;
    today_tx_bytes: number | null;
    yesterday_rx_bytes: number | null;
    yesterday_tx_bytes: number | null;
    last24h_rx_bytes: number | null;
    last24h_tx_bytes: number | null;
    monthly_bytes: number | null;
    /** ms, average of the last bucket */
    latency: number | null;
    /** Percent, average of the last bucket */
    packet_loss: number | null;
    speedtest_download: number | null;
    speedtest_upload: number | null;
    speedtest_latency: number | null;
    /** ms since epoch */
    speedtest_time: number | null;
}

/**
 * History requested from the dashboard: 50 hours, so yesterday is complete at any time of the day (also on the day
 * with 25 hours). The controller answers with hourly buckets for up to 7 days.
 */
export const WAN_HISTORY_SECONDS = 50 * 3600;

const HOUR = 3600 * 1000;

/**
 * @param value any value
 * @returns the number or null
 */
function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Length of a bucket in ms, from the distance of the first two buckets
 *
 * @param history buckets sorted by time
 */
function bucketLength(history: WanHistoryBucket[]): number {
    return history.length > 1 ? history[1].timestamp - history[0].timestamp : HOUR;
}

/**
 * Bytes received and sent in the buckets that start in [from, to).
 *
 * A direction is null if the history does not cover the start of the interval (e.g. yesterday, when the history
 * starts today after the update to UniFi Network 11) or if no bucket of the interval has a rate for it. A measured
 * rate of 0 gives 0.
 *
 * @param history buckets sorted by time
 * @param from start in ms
 * @param to end in ms
 */
function sumBytes(history: WanHistoryBucket[], from: number, to: number): { rx: number | null; tx: number | null } {
    // The history must start at or before the start of the interval
    if (history.length === 0 || history[0].timestamp > from) {
        return { rx: null, tx: null };
    }

    const seconds = bucketLength(history) / 1000;
    let rx: number | null = null;
    let tx: number | null = null;
    for (const bucket of history) {
        if (bucket.timestamp >= from && bucket.timestamp < to) {
            const rxRate = num(bucket.avg_rx_rate_bps);
            const txRate = num(bucket.avg_tx_rate_bps);
            if (rxRate !== null) {
                rx = (rx ?? 0) + rxRate * seconds;
            }
            if (txRate !== null) {
                tx = (tx ?? 0) + txRate * seconds;
            }
        }
    }
    return { rx: rx === null ? null : Math.round(rx), tx: tx === null ? null : Math.round(tx) };
}

/**
 * Summarize the WAN connections of the dashboard
 *
 * @param dashboard answer of `aggregated-dashboard?historySeconds=WAN_HISTORY_SECONDS`
 * @param now current time in ms, days are calculated in the local time zone
 */
export function summarizeWan(dashboard: AggregatedDashboard, now = Date.now()): WanSummary[] {
    const details = dashboard.wan?.wan_details ?? [];
    const activity = dashboard.wan_activity?.activity_by_network_group ?? {};

    // Groups from the details, plus groups that only have activity
    const groups = [
        ...new Set([
            ...details.map(d => d.network_group).filter((g): g is string => typeof g === 'string' && g !== ''),
            ...Object.keys(activity),
        ]),
    ];

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    return groups.map(group => {
        const detail = details.find(d => d.network_group === group);
        const history = [...(activity[group]?.history ?? [])]
            .filter(b => typeof b?.timestamp === 'number')
            .sort((a, b) => a.timestamp - b.timestamp);
        const last = history[history.length - 1];

        const today = sumBytes(history, todayStart.getTime(), Infinity);
        const yesterday = sumBytes(history, yesterdayStart.getTime(), todayStart.getTime());
        const last24h = sumBytes(history, now - 24 * HOUR, Infinity);

        const uptime = dashboard.wan_history?.wan_history_details?.find(h => h.network_group === group)?.uptime;
        const speedTest = (dashboard.speed_test?.data ?? [])
            .filter(s => s.wan_networkgroup === group)
            .sort((a, b) => (num(b.time) ?? 0) - (num(a.time) ?? 0))[0];
        const capabilities = detail?.isp?.capabilities;
        const kbitToMbit = (value: unknown): number | null => {
            const kbit = num(value);
            return kbit === null ? null : Math.round(kbit / 1000);
        };

        return {
            id: group,
            name: detail?.network_name ?? null,
            isp_name: detail?.isp?.name ?? null,
            isp_asn: num(detail?.isp?.asn),
            capacity_download: kbitToMbit(capabilities?.download_kilobits_per_second),
            capacity_upload: kbitToMbit(capabilities?.upload_kilobits_per_second),
            up: typeof detail?.status?.up === 'boolean' ? detail.status.up : null,
            active: typeof detail?.status?.is_active === 'boolean' ? detail.status.is_active : null,
            interface: detail?.status?.interface_name ?? null,
            uptime: num(uptime),
            rx_rate: num(detail?.stats?.activity?.['rx_bytes-r']),
            tx_rate: num(detail?.stats?.activity?.['tx_bytes-r']),
            today_rx_bytes: today.rx,
            today_tx_bytes: today.tx,
            yesterday_rx_bytes: yesterday.rx,
            yesterday_tx_bytes: yesterday.tx,
            last24h_rx_bytes: last24h.rx,
            last24h_tx_bytes: last24h.tx,
            monthly_bytes: num(detail?.stats?.monthly_bytes),
            latency: num(last?.avg_latency_ms),
            packet_loss: num(last?.avg_packet_loss_pct),
            speedtest_download: num(speedTest?.download_mbps),
            speedtest_upload: num(speedTest?.upload_mbps),
            speedtest_latency: num(speedTest?.latency_ms),
            speedtest_time: num(speedTest?.time),
        };
    });
}
