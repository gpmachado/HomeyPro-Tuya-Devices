/**
 * File: device.js - Zemismart 6-Gang Wall Switch
 * Version: 3.3.0 - Production Release
 * 
 * Features:
 * - Power outage recovery with Always OFF behavior (hardware default)
 * - Rejoin detection for proper sync after power restoration
 * - Clean operation without unwanted sync
 * - Production-level logging
 */

'use strict';

const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");
const { getDataValue } = require('../../lib/TuyaHelpers');

Cluster.addCluster(TuyaSpecificCluster);

class ZemismartWallSwitch6Gang extends TuyaSpecificClusterDevice {

  getMyDp() {
    const { subDeviceId } = this.getData();
    switch(subDeviceId) {
      case 'secondGang': return 2;
      case 'thirdGang': return 3;
      case 'fourthGang': return 4;
      case 'fifthGang': return 5;
      case 'sixthGang': return 6;
      default: return 1;
    }
  }

  isMyDp(dp) {
    const { subDeviceId } = this.getData();
    
    if (this.isSubDevice()) {
      return dp === this.getMyDp();
    } else {
      return dp === 1; // Main device handles gang 1 only (no DP14)
    }
  }

  async onNodeInit({ zclNode }) {
    this._zclNode = zclNode;
    this._rejoinState = {
      initTime: Date.now(),
      rejoinCount: 0,
      lastRejoinTime: null
    };
    
    this.log(`${this.getGangName()} initialized`);
    
    // Capability listener
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

    // Tuya cluster listeners
    zclNode.endpoints[1].clusters.tuya.on("reporting", this.processDatapoint.bind(this));
    zclNode.endpoints[1].clusters.tuya.on("response", this.processDatapoint.bind(this));

    // Rejoin detection
    this._setupRejoinHandling();

    // Initial status request
    this.homey.setTimeout(() => {
      this._requestInitialStatus();
    }, 2000);
  }

  _setupRejoinHandling() {
    this._zclNode.on('online', async () => {
      await this._handleRejoinEvent('online');
    });

    this._zclNode.on('announce', async () => {
      await this._handleRejoinEvent('announce');
    });
  }

  async _handleRejoinEvent(eventType) {
    const timestamp = Date.now();
    const timeSinceLastRejoin = this._rejoinState.lastRejoinTime ? 
      timestamp - this._rejoinState.lastRejoinTime : Infinity;
    
    // Ignore rapid rejoins (within 30 seconds)
    if (timeSinceLastRejoin < 30000) {
      return;
    }
    
    this._rejoinState.rejoinCount++;
    this._rejoinState.lastRejoinTime = timestamp;
    
    this.log(`${this.getGangName()} rejoined network - syncing states (Always OFF after power outage)`);
    
    try {
      // Mark as available
      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      // Network stabilization delay
      await this.sleep(2000);

      // Read current states to sync dashboard
      // Note: 6-Gang hardware uses Always OFF behavior after power outage
      if (!this.isSubDevice()) {
        await this._requestAllGangStates();
      } else {
        await this._requestMyState();
      }

    } catch (error) {
      this.error(`Rejoin handling failed: ${error.message}`);
    }
  }

  async _requestAllGangStates() {
    if (!this._zclNode || !this.getAvailable()) {
      return;
    }
    
    try {
      const gangDPs = [1, 2, 3, 4, 5, 6];
      for (const dp of gangDPs) {
        await this.writeRaw(dp, Buffer.from([0x00]));
        await this.sleep(200);
      }
    } catch (error) {
      if (!error.message.includes('Missing Zigbee Node')) {
        this.error(`Gang state request failed: ${error.message}`);
      }
    }
  }

  async _requestMyState() {
    const myDp = this.getMyDp();
    
    if (!this._zclNode || !this.getAvailable()) {
      return;
    }
    
    try {
      await this.writeRaw(myDp, Buffer.from([0x00]));
    } catch (error) {
      if (!error.message.includes('Missing Zigbee Node')) {
        this.error(`State request failed: ${error.message}`);
      }
    }
  }

  async _requestInitialStatus() {
    if (!this._zclNode || !this.getAvailable()) {
      return;
    }

    try {
      if (!this.isSubDevice()) {
        const dps = [1, 2, 3, 4, 5, 6];
        for (const dp of dps) {
          await this.writeRaw(dp, Buffer.from([0x00]));
          await this.sleep(150);
        }
      } else {
        await this._requestMyState();
      }
    } catch (error) {
      if (!error.message.includes('Missing Zigbee Node')) {
        this.error(`Initial status request failed: ${error.message}`);
      }
    }
  }

  async onCapabilityOnOff(value, opts) {
    const dp = this.getMyDp();
    
    try {
      await this.writeBool(dp, value);
      return true;
    } catch (err) {
      this.error(`Command failed: ${err.message}`);
      throw err;
    }
  }

  async processDatapoint(data) {
    const dp = data.dp;
    const value = getDataValue(data);
    
    if (!this.isMyDp(dp)) {
      return;
    }

    // All DPs (1-6) represent switch states
    if (dp >= 1 && dp <= 6) {
      try {
        await this.setCapabilityValue('onoff', value);
      } catch (err) {
        this.error(`State update failed: ${err.message}`);
      }
    }
  }

  getGangName() {
    const { subDeviceId } = this.getData();
    switch(subDeviceId) {
      case 'secondGang': return 'Gang 2';
      case 'thirdGang': return 'Gang 3';
      case 'fourthGang': return 'Gang 4';
      case 'fifthGang': return 'Gang 5';
      case 'sixthGang': return 'Gang 6';
      default: return 'Gang 1';
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async onEndDeviceAnnounce() {
    await this._handleRejoinEvent('announce');
  }

  async onAvailable() {
    this.homey.setTimeout(() => {
      this._requestInitialStatus();
    }, 1000);
  }

  onDeleted() {
    if (this._zclNode) {
      this._zclNode.removeAllListeners('online');
      this._zclNode.removeAllListeners('announce');
    }
    
    super.onDeleted();
  }
}

module.exports = ZemismartWallSwitch6Gang;