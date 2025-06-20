/**
 * File: driver.js - Enhanced Zemismart 4 Gang Switch Driver
 * Version: 3.4.0 - Added custom flow cards and momentary mode
 */

'use strict';

const { ZigBeeDriver } = require("homey-zigbeedriver");

class ZemismartWallSwitch4GangDriver extends ZigBeeDriver {

  async onInit() {
    await super.onInit();
    this.log('Zemismart 4-Gang Wall Switch driver v3.4.0 initialized');
    
    this._registerFlowCards();
  }

  _registerFlowCards() {
    try {
      this._stateChangedTrigger = this.homey.flow.getDeviceTriggerCard('state_changed');

      this.log('Flow cards registered successfully');
    } catch (error) {
      this.error('Failed to register flow cards:', error);
    }
  }

  async triggerStateChanged(device, tokens, state) {
    try {
      await this._stateChangedTrigger.trigger(device, tokens, state);
      this.log(`State changed flow triggered for ${device.getName()} from ${tokens.fromState} to ${tokens.toState}`);
    } catch (error) {
      this.error('Failed to trigger state changed flow:', error);
    }
  }

  async onPairListDevices() {
    const timestamp = Date.now();
    const mainDeviceId = `zemismart_4gang_${timestamp}`;
    return [
      {
        name: 'Zemismart Wall Switch 4 Gang - Gang 1',
        data: {
          id: mainDeviceId,
          subDeviceId: 'firstGang',
          gang: 1
        },
        capabilities: ['onoff'],
        store: {
          isSubDevice: false
        },
        settings: {
          power_on_behavior: 'memory',
          switch_mode: 'switch',
          momentary_timeout: 1
        }
      },
      {
        name: 'Zemismart Wall Switch 4 Gang - Gang 2',
        data: {
          id: `${mainDeviceId}_2`,
          subDeviceId: 'secondGang',
          gang: 2,
          parentId: mainDeviceId
        },
        capabilities: ['onoff'],
        store: {
          isSubDevice: true
        },
        settings: {
          power_on_behavior: 'memory',
          switch_mode: 'switch',
          momentary_timeout: 1
        }
      },
      {
        name: 'Zemismart Wall Switch 4 Gang - Gang 3',
        data: {
          id: `${mainDeviceId}_3`,
          subDeviceId: 'thirdGang',
          gang: 3,
          parentId: mainDeviceId
        },
        capabilities: ['onoff'],
        store: {
          isSubDevice: true
        },
        settings: {
          power_on_behavior: 'memory',
          switch_mode: 'switch',
          momentary_timeout: 1
        }
      },
      {
        name: 'Zemismart Wall Switch 4 Gang - Gang 4',
        data: {
          id: `${mainDeviceId}_4`,
          subDeviceId: 'fourthGang',
          gang: 4,
          parentId: mainDeviceId
        },
        capabilities: ['onoff'],
        store: {
          isSubDevice: true
        },
        settings: {
          power_on_behavior: 'memory',
          switch_mode: 'switch',
          momentary_timeout: 1
        }
      }
    ];
  }

  async onRepair(session, device) {
    this.log('Device repair initiated for:', device.getName());
    
    session.setHandler('start_repair', async () => {
      this.log('Starting repair process...');
      return true;
    });

    session.setHandler('repair_failed', async (error) => {
      this.error('Repair failed:', error);
      throw new Error('Device repair failed. Please try removing and re-adding the device.');
    });

    session.setHandler('repair_success', async () => {
      this.log('Device repair completed successfully');
      return true;
    });
  }

  async onDeleteDevice(device) {
    try {
      this.log(`Deleting device: ${device.getName()}`);
      
      if (!device.isSubDevice()) {
        this.log('Main device deletion - checking for sub-devices...');
        const allDevices = this.getDevices();
        const sameNodeDevices = allDevices.filter(d => {
          return d._physicalNodeId === device._physicalNodeId && d.isSubDevice();
        });
        
        this.log(`Found ${sameNodeDevices.length} sub-devices to clean up`);
        
        for (const subDevice of sameNodeDevices) {
          try {
            await subDevice.setUnavailable('Physical device removed');
            this.log(`Sub-device ${subDevice.getName()} marked as unavailable`);
          } catch (error) {
            this.error(`Error handling sub-device ${subDevice.getName()}:`, error);
          }
        }
      }
      
      this.log(`Device ${device.getName()} deletion handled successfully`);
    } catch (error) {
      this.error('Error during device deletion:', error);
    }
  }

  onUninit() {
    this.log('Zemismart 4-Gang Wall Switch driver stopped');
  }
}

module.exports = ZemismartWallSwitch4GangDriver;