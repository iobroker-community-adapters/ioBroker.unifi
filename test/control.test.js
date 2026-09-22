'use strict';

// Writable states that control the UniFi controller

const assert = require('node:assert');
const sinon = require('sinon');
const { createAdapter } = require('./lib/adapterMock');

const MAC = 'aa:bb:cc:dd:ee:01';

describe('control states', () => {
    let adapter;
    let controller;

    beforeEach(() => {
        adapter = createAdapter();
        controller = {
            restartDevice: sinon.stub().resolves([]),
            setLEDOverride: sinon.stub().resolves([]),
            powerCycleSwitchPort: sinon.stub().resolves([]),
            reconnectClient: sinon.stub().resolves([]),
            blockClient: sinon.stub().resolves([]),
            unblockClient: sinon.stub().resolves([]),
            getAccessDevices: sinon.stub().resolves([]),
            setDeviceSettingsBase: sinon.stub().resolves([]),
            createVouchers: sinon.stub().resolves([{ create_time: 1 }]),
            getVouchers: sinon.stub().resolves([]),
        };
        adapter.controllers.default = controller;
    });

    const write = (id, val, ack = false) => adapter.onStateChange(`unifi.0.default.${id}`, { val, ack });

    it('ignores acknowledged values', async () => {
        await write(`devices.${MAC}.restart`, true, true);

        sinon.assert.notCalled(controller.restartDevice);
    });

    it('restarts a device', async () => {
        await write(`devices.${MAC}.restart`, true);

        sinon.assert.calledOnceWithExactly(controller.restartDevice, MAC, 'soft');
    });

    it('overrides the LED with the ID of the device', async () => {
        adapter.states.set(`unifi.0.default.devices.${MAC}.device_id`, { val: 'dev1', ack: true });

        await write(`devices.${MAC}.led_override`, 'off');

        sinon.assert.calledOnceWithExactly(controller.setLEDOverride, 'dev1', 'off');
    });

    it('logs an error when the ID of the device for the LED is missing', async () => {
        await write(`devices.${MAC}.led_override`, 'off');

        sinon.assert.notCalled(controller.setLEDOverride);
        sinon.assert.calledWithMatch(adapter.log.error, /device_id/);
    });

    it('power cycles a switch port', async () => {
        await write(`devices.${MAC}.port_table.port_3.port_poe_cycle`, true);

        sinon.assert.calledOnceWithExactly(controller.powerCycleSwitchPort, MAC, '3');
    });

    it('reconnects a client', async () => {
        await write(`clients.${MAC}.reconnect`, true);

        sinon.assert.calledOnceWithExactly(controller.reconnectClient, MAC);
    });

    it('blocks and unblocks a client', async () => {
        await write(`clients.${MAC}.blocked`, true);
        await write(`clients.${MAC}.blocked`, false);

        sinon.assert.calledOnceWithExactly(controller.blockClient, MAC);
        sinon.assert.calledOnceWithExactly(controller.unblockClient, MAC);
    });

    it('creates vouchers with the settings in the order of node-unifi 2', async () => {
        Object.assign(adapter.vouchers, {
            number: '3',
            duration: 1440,
            quota: 2,
            uploadLimit: 1000,
            downloadLimit: '5000',
            byteQuota: 100,
            note: 'Party',
        });

        await write('vouchers.create_vouchers', true);

        sinon.assert.calledOnceWithExactly(controller.createVouchers, 1440, 3, 2, 'Party', 1000, 5000, 100);
        sinon.assert.calledOnce(controller.getVouchers);
        sinon.assert.calledWith(adapter.log.info, 'Vouchers created');
    });

    it('uses the defaults for vouchers that are not configured', async () => {
        await write('vouchers.create_vouchers', true);

        sinon.assert.calledOnceWithExactly(controller.createVouchers, 60, 1, 1, '', 0, 0, 0);
    });

    it('triggers an update without scheduling the next one', async () => {
        adapter.updateUnifiData = sinon.stub().resolves();

        await adapter.onStateChange('unifi.0.trigger_update', { val: true, ack: false });

        sinon.assert.calledOnceWithExactly(adapter.updateUnifiData, true);
    });

    describe('PoE', () => {
        const device = poeMode => ({
            mac: MAC,
            device_id: 'dev1',
            port_overrides: [
                { port_idx: 1, poe_mode: 'auto' },
                { port_idx: 3, poe_mode: poeMode },
            ],
        });

        it('switches the PoE of a port and sends the overrides of all ports', async () => {
            controller.getAccessDevices.resolves([device('auto')]);

            await adapter.switchPoeOfPort('default', MAC, '3', false);

            sinon.assert.calledOnceWithExactly(controller.setDeviceSettingsBase, 'dev1', {
                port_overrides: [
                    { port_idx: 1, poe_mode: 'auto' },
                    { port_idx: 3, poe_mode: 'off' },
                ],
            });
        });

        it('switches the PoE on', async () => {
            controller.getAccessDevices.resolves([device('off')]);

            await adapter.switchPoeOfPort('default', MAC, '3', true);

            assert.strictEqual(controller.setDeviceSettingsBase.firstCall.args[1].port_overrides[1].poe_mode, 'auto');
        });

        it('fails for a port without override, as before', async () => {
            controller.getAccessDevices.resolves([device('auto')]);

            await adapter.switchPoeOfPort('default', MAC, '5', true);

            sinon.assert.notCalled(controller.setDeviceSettingsBase);
            sinon.assert.calledWithMatch(adapter.log.error, /port 5 has no port_overrides entry/);
        });

        it('is triggered by the port_poe_enabled state', async () => {
            adapter.switchPoeOfPort = sinon.stub().resolves();

            await write(`devices.${MAC}.port_table.port_3.port_poe_enabled`, true);

            sinon.assert.calledOnceWithExactly(adapter.switchPoeOfPort, 'default', MAC, '3', true);
        });
    });
});
