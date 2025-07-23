/**
 * File: driver.js - MOES 3-Gang Fan Controller Driver
 * Version: 1.5.0 - Ultra Simplified
 * Author: Clean implementation for fan control
 */

'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class Fan3GangMoesDriver extends ZigBeeDriver {

  async onInit() {
    this.log('MOES 3-Gang Fan Controller Driver v1.5.0 initialized');
  }

}

module.exports = Fan3GangMoesDriver;