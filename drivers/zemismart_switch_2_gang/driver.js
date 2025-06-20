/**
 * File: driver.js
 * Device: Zemismart Wall Switch 2 Gang Driver
 * Version: 3.3.0
 * Date: 2025-06-18
 * Author: Standardized version aligned with Zemismart family
 * 
 * Description:
 * - Enhanced ZigBee driver for Zemismart 2-gang wall switches
 * - Supports automatic device discovery and repair functionality
 * - Manages main device and sub-device lifecycle
 * - Consistent with TS000X family behavior
 * 
 * Features:
 * - Automatic device pairing and discovery
 * - Multi-endpoint support (1,2)
 * - Sub-device management
 * - Production-level error handling
 */

'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class ZemismartWallSwitch2GangDriver extends ZigBeeDriver {

  /**
   * Driver initialization
   */
  onInit() {
    this.log('Zemismart Wall Switch 2 Gang driver v3.3.0 initialized');
  }

  /**
   * Device pairing - automatic discovery
   * Lets Homey handle device discovery automatically for consistent behavior
   * @returns {Array} Empty array to enable automatic discovery
   */
  async onPairListDevices() {
    return []; // Let Homey handle discovery automatically
  }

  /**
   * Handle device repair and re-pairing process
   * @param {Object} session - Repair session object
   * @param {Object} device - Device instance being repaired
   */
  async onRepair(session, device) {
    this.log('Device repair initiated for:', device.getName());
    
    // Standard repair flow - let Homey handle the ZigBee repair process
    session.setHandler('start_repair', async () => {
      this.log('Starting device repair process...');
      return true;
    });

    session.setHandler('repair_failed', async (error) => {
      this.error('Device repair failed:', error);
      throw new Error('Device repair failed. Please try removing and re-adding the device.');
    });

    session.setHandler('repair_success', async () => {
      this.log('Device repair completed successfully');
      return true;
    });
  }

  /**
   * Handle device deletion from driver level
   * Manages cleanup of main device and associated sub-devices
   * @param {Object} device - Device instance being deleted
   */
  async onDeleteDevice(device) {
    try {
      this.log(`Deleting device: ${device.getName()}`);
      
      // If this is the main device, ensure all sub-devices are properly handled
      if (!device.isSubDevice()) {
        this.log('Main device deletion - checking for associated sub-devices...');
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
   * Driver cleanup and shutdown
   */
  onUninit() {
    this.log('Zemismart Wall Switch 2 Gang driver stopped');
  }
}

module.exports = ZemismartWallSwitch2GangDriver;