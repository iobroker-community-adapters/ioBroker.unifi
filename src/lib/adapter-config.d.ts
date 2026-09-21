// Augments the globally declared ioBroker types with everything this adapter adds.
// Keep in sync with `native` in io-package.json and with admin/jsonConfig.json.

import type { UnifiObjectsFilter, UnifiStatesFilter } from './types';

declare global {
    namespace ioBroker {
        // Numbers may be strings: the old admin page (index_m.html) stored all input fields as text
        interface AdapterConfig {
            controllerIp: string;
            /** Empty for UniFi OS */
            controllerPort: string | number | null;
            controllerUsername: string;
            controllerPassword: string;
            ignoreSSLErrors: boolean;
            /** In seconds */
            updateInterval: number | string;

            updateClients: boolean;
            /** Use the objects filter of the clients as whitelist */
            blacklistClients: boolean;
            updateDevices: boolean;
            updateHealth: boolean;
            updateNetworks: boolean;
            updateSysinfo: boolean;
            updateVouchers: boolean;
            updateVouchersNoUsed: boolean;
            updateWlans: boolean;
            updateAlarms: boolean;
            updateAlarmsNoArchived: boolean;
            updateDpi: boolean;
            updateGatewayTraffic: boolean;
            /** 0 = all available data */
            gatewayTrafficMaxDays: number | string;

            objectsFilter: UnifiObjectsFilter;
            statesFilter: UnifiStatesFilter;
            /** In seconds */
            clientsIsOnlineOffset: number | string;

            createVouchersNumber: number | string | null;
            /** In minutes */
            createVouchersDuration: number | string | null;
            createVouchersQuota: number | string | null;
            /** In Kbps */
            createVouchersUploadLimit: number | string | null;
            /** In Kbps */
            createVouchersDownloadLimit: number | string | null;
            /** In MB */
            createVouchersByteQuota: number | string | null;
            createVouchersNote: string;

            /** Renamed to objectsFilter in 0.5.3, migrated on start */
            blacklist?: UnifiObjectsFilter | null;
            /** Renamed to statesFilter in 0.5.3, migrated on start */
            whitelist?: UnifiStatesFilter | null;
        }
    }
}

export {}; // required, so the file is a module
