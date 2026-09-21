// node-unifi has no typings. Only the methods used by this adapter are declared.
declare module 'node-unifi' {
    export interface ControllerOptions {
        host: string;
        /** Empty for UniFi OS */
        port: string | number;
        username: string;
        password: string;
        /** Default: 'default' */
        site?: string;
        /** Default: true */
        sslverify?: boolean;
        /** Request timeout in ms. Default: 5000 */
        timeout?: number;
    }

    /** The methods resolve with the `data` part of the controller response. */
    export class Controller {
        constructor(options: ControllerOptions);

        /** Logs in on the first call only, later calls do nothing */
        login(username?: string | null, password?: string | null, token2FA?: string | null): Promise<boolean>;

        getSites(): Promise<unknown>;
        getSiteSysinfo(): Promise<unknown>;
        getClientDevices(clientMac?: string): Promise<unknown>;
        getBlockedUsers(within?: number): Promise<unknown>;
        getAccessDevices(deviceMac?: string): Promise<unknown>;
        getWLanSettings(wlanId?: string | null): Promise<unknown>;
        getNetworkConf(networkId?: string | null): Promise<unknown>;
        getHealth(): Promise<unknown>;
        getVouchers(createTime?: number | null): Promise<unknown>;
        getDPIStats(): Promise<unknown>;
        getDailyGatewayStats(start?: number | null, end?: number | null, attribs?: string[] | null): Promise<unknown>;
        getAlarms(payload?: Record<string, unknown> | null): Promise<unknown>;

        disableWLan(wlanId: string, disable: boolean): Promise<unknown>;
        createVouchers(
            minutes: number,
            count?: number,
            quota?: number,
            note?: string | null,
            up?: number | null,
            down?: number | null,
            megabytes?: number | null,
        ): Promise<unknown>;
        setDeviceSettingsBase(deviceId: string, payload: Record<string, unknown>): Promise<unknown>;
        reconnectClient(mac: string): Promise<unknown>;
        blockClient(mac: string): Promise<unknown>;
        unblockClient(mac: string): Promise<unknown>;
        powerCycleSwitchPort(switchMac: string, portIdx: number | string): Promise<unknown>;
        setLEDOverride(deviceId: string, overrideMode: string): Promise<unknown>;
        restartDevice(mac: string, rebootType?: 'soft' | 'hard'): Promise<unknown>;
    }
}
