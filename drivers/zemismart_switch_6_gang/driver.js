'use strict';

/**
 * File: driver.js - Enhanced Zemismart 6 Gang Switch Driver
 * Version: 3.3.0 - Enhanced with lifecycle management and repair functionality
 * Author: Enhanced for Homey Pro with comprehensive driver management
 */

const { ZigBeeDriver } = require("homey-zigbeedriver");

class ZemismartWallSwitch6GangDriver extends ZigBeeDriver {

  /**
   * Driver initialization
   */
  onInit() {
    this.log('Zemismart 6-Gang Wall Switch driver v3.3.0 initialized');
  }

  /**
   * Device pairing - automatic discovery (consistent across TS family)
   */
  async onPairListDevices() {
    return []; // Let Homey handle discovery automatically
  }

  /**
   * Handle device repair/re-pairing
   */
  async onRepair(session, device) {
    this.log('Device repair initiated for:', device.getName());
    
    // Standard repair flow - let Homey handle the ZigBee repair process
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

  /**
   * Handle device deletion from driver level
   */
  async onDeleteDevice(device) {
    try {
      this.log(`Deleting device: ${device.getName()}`);
      
      // If this is the main device, ensure all sub-devices are also handled
      if (!device.isSubDevice()) {
        this.log('Main device deletion - checking for sub-devices...');
        const allDevices = this.getDevices();
        const sameNodeDevices = allDevices.filter(d => {
          return d._physicalNodeId === device._physicalNodeId && d.isSubDevice();
        });
        
        this.log(`Found ${sameNodeDevices.length} sub-devices to clean up`);
        
        // Mark sub-devices as unavailable since the physical device is being removed
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

  /**
   * Driver cleanup
   */
  onUninit() {
    this.log('Zemismart 6-Gang Wall Switch driver stopped');
  }
}

module.exports = ZemismartWallSwitch6GangDriver;