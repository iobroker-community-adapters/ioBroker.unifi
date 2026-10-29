'use strict';

// WAN statistics of UniFi Network 11+ from the aggregated dashboard

const assert = require('node:assert');
const { summarizeWan, WAN_HISTORY_SECONDS } = require('../build/lib/wan');

const HOUR = 3600 * 1000;

/**
 * Hourly buckets with the same rates, starting at `start`
 *
 * @param {number} start ms
 * @param {number} hours number of buckets
 * @param {number} rx bytes per second
 * @param {number} tx bytes per second
 */
function hourly(start, hours, rx, tx) {
    return Array.from({ length: hours }, (_, i) => ({
        timestamp: start + i * HOUR,
        avg_rx_rate_bps: rx,
        avg_tx_rate_bps: tx,
        avg_latency_ms: 2 + i,
        avg_packet_loss_pct: 0,
    }));
}

/** 27.10.2026 14:30 local time */
const NOW = new Date(2026, 9, 27, 14, 30).getTime();
const TODAY = new Date(2026, 9, 27).getTime();
const YESTERDAY = new Date(2026, 9, 26).getTime();

const DASHBOARD = {
    wan_activity: {
        activity_by_network_group: {
            // 2 h of the day before yesterday, 24 h yesterday, 15 h today (until 14:00 + the running hour)
            WAN: {
                history: [
                    ...hourly(YESTERDAY - 2 * HOUR, 2, 1000, 100),
                    ...hourly(YESTERDAY, 24, 100, 10),
                    ...hourly(TODAY, 15, 10, 1),
                ],
            },
        },
    },
    wan: {
        wan_details: [
            {
                network_group: 'WAN',
                network_name: 'Internet 1',
                isp: {
                    name: 'Deutsche Telekom AG',
                    asn: 3320,
                    capabilities: { download_kilobits_per_second: 642000, upload_kilobits_per_second: 327000 },
                },
                stats: { activity: { 'rx_bytes-r': 10000, 'tx_bytes-r': 4000 }, monthly_bytes: 1129721783308 },
                status: { interface_name: 'ppp0', is_active: true, up: true },
            },
        ],
    },
    wan_history: { wan_history_details: [{ network_group: 'WAN', uptime: 100 }] },
    speed_test: {
        data: [
            { wan_networkgroup: 'WAN', download_mbps: 600, upload_mbps: 300, latency_ms: 4, time: NOW - 2 * HOUR },
            { wan_networkgroup: 'WAN', download_mbps: 641, upload_mbps: 326, latency_ms: 3, time: NOW - HOUR },
        ],
    },
};

describe('WAN statistics', () => {
    it('requests enough history for a complete yesterday, also on a day with 25 hours', () => {
        assert.ok(WAN_HISTORY_SECONDS >= 49 * 3600);
    });

    it('sums the traffic of today, yesterday and the last 24 hours in local time', () => {
        const [wan] = summarizeWan(DASHBOARD, NOW);

        assert.strictEqual(wan.today_rx_bytes, 15 * 3600 * 10);
        assert.strictEqual(wan.today_tx_bytes, 15 * 3600 * 1);
        assert.strictEqual(wan.yesterday_rx_bytes, 24 * 3600 * 100);
        assert.strictEqual(wan.yesterday_tx_bytes, 24 * 3600 * 10);
        // buckets starting after 14:30 yesterday: 15:00 ... 23:00 (9) and today (15)
        assert.strictEqual(wan.last24h_rx_bytes, 9 * 3600 * 100 + 15 * 3600 * 10);
    });

    it('takes the details of the connection, the latest bucket and the latest speed test', () => {
        const [wan] = summarizeWan(DASHBOARD, NOW);

        assert.deepStrictEqual(
            {
                id: wan.id,
                name: wan.name,
                isp: wan.isp_name,
                asn: wan.isp_asn,
                down: wan.capacity_download,
                up: wan.capacity_upload,
                connected: wan.up,
                uptime: wan.uptime,
                rx_rate: wan.rx_rate,
                monthly: wan.monthly_bytes,
                latency: wan.latency,
                speed: [wan.speedtest_download, wan.speedtest_upload, wan.speedtest_latency, wan.speedtest_time],
            },
            {
                id: 'WAN',
                name: 'Internet 1',
                isp: 'Deutsche Telekom AG',
                asn: 3320,
                down: 642,
                up: 327,
                connected: true,
                uptime: 100,
                rx_rate: 10000,
                monthly: 1129721783308,
                latency: 16,
                speed: [641, 326, 3, NOW - HOUR],
            },
        );
    });

    it('returns a connection per network group, also without details', () => {
        const dashboard = structuredClone(DASHBOARD);
        dashboard.wan_activity.activity_by_network_group.WAN2 = { history: hourly(TODAY, 2, 5, 5) };

        const wans = summarizeWan(dashboard, NOW);

        assert.deepStrictEqual(
            wans.map(w => w.id),
            ['WAN', 'WAN2'],
        );
        assert.strictEqual(wans[1].name, null);
        assert.strictEqual(wans[1].today_rx_bytes, 2 * 3600 * 5);
        assert.strictEqual(wans[1].speedtest_download, null);
    });

    it('has no values for intervals before the start of the history (e.g. after the update to Network 11)', () => {
        const dashboard = structuredClone(DASHBOARD);
        dashboard.wan_activity.activity_by_network_group.WAN.history = hourly(TODAY, 15, 10, 1);

        const [wan] = summarizeWan(dashboard, NOW);

        assert.strictEqual(wan.today_rx_bytes, 15 * 3600 * 10);
        assert.strictEqual(wan.yesterday_rx_bytes, null);
        assert.strictEqual(wan.yesterday_tx_bytes, null);
        assert.strictEqual(wan.last24h_rx_bytes, null);
    });

    it('has no value for a direction without rates, but 0 for measured zero rates', () => {
        const dashboard = structuredClone(DASHBOARD);
        for (const bucket of dashboard.wan_activity.activity_by_network_group.WAN.history) {
            delete bucket.avg_tx_rate_bps;
            bucket.avg_rx_rate_bps = 0;
        }

        const [wan] = summarizeWan(dashboard, NOW);

        assert.strictEqual(wan.today_rx_bytes, 0);
        assert.strictEqual(wan.yesterday_rx_bytes, 0);
        assert.strictEqual(wan.today_tx_bytes, null);
        assert.strictEqual(wan.yesterday_tx_bytes, null);
    });

    it('has no traffic values without history (instead of 0)', () => {
        const dashboard = structuredClone(DASHBOARD);
        delete dashboard.wan_activity;

        const [wan] = summarizeWan(dashboard, NOW);

        assert.strictEqual(wan.today_rx_bytes, null);
        assert.strictEqual(wan.latency, null);
        assert.strictEqual(wan.isp_name, 'Deutsche Telekom AG');
    });

    it('returns nothing for an empty dashboard', () => {
        assert.deepStrictEqual(summarizeWan({}, NOW), []);
    });
});

module.exports = { DASHBOARD, NOW };
