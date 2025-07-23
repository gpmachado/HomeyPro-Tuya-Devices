/*
 * Device driver for TS011F _TZ3000_cfnprab5 Power Strip
 * Version: 2.2
 * Author: Homey Driver
 * Description: 4 sockets + USB - working version without reporting errors
 */

'use strict';

const Homey = require('homey');
const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class socket_power_strip extends ZigBeeDevice {
		
	async onNodeInit({zclNode}) {

		this.printNode();
        this.log("Device driver version 2.2 initialized");

        const { subDeviceId } = this.getData();
        this.log("Device data subDeviceId:", subDeviceId);

        // Map subDeviceId to endpoint - 4 sockets + USB
        const endpointMap = {
            'socket2': 2,
            'socket3': 3,
            'socket4': 4,
            'usb': 5
        };
        
        const endpoint = endpointMap[subDeviceId] || 1;
        this.log(`Using endpoint ${endpoint} for ${subDeviceId || 'main socket'}`);

        // Register onoff capability
        this.registerCapability('onoff', CLUSTER.ON_OFF, {
            endpoint: endpoint
        });

        this.log(`${subDeviceId || 'Main device'} initialized successfully on endpoint ${endpoint}`);
    }

	onDeleted(){
		this.log("Power Strip device removed - version 2.2");
	}

}

module.exports = socket_power_strip;