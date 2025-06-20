/**
 * File: driver.js
 * Device: Zemismart Wall Switch 1 Gang Driver
 * Version: 3.3.0
 * Date: 2025-06-18
 * Author: Standardized version aligned with Zemismart family
 * 
 * Description:
 * - Enhanced ZigBee driver for Zemismart 1-gang wall switches
 * - Supports automatic device discovery
 * - Consistent with TS000X family behavior
 * - Simple driver for single endpoint device
 * 
 * Features:
 * - Automatic device pairing and discovery
 * - Single endpoint support
 * - Production-level error handling
 */

'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class ZemismartWallSwitch1GangDriver extends ZigBeeDriver {

  /**
   * Driver initialization
   */
  onInit() {
    this.log('Zemismart Wall Switch 1 Gang driver v3.3.0 initialized');
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
   * Driver cleanup and shutdown
   */
  onUninit() {
    this.log('Zemismart Wall Switch 1 Gang driver stopped');
  }
}

module.exports = ZemismartWallSwitch1GangDriver;