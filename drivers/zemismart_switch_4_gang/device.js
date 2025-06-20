/**
 * File: device.js - Zemismart 4-Gang Wall Switch
 * Version: 3.4.1 - Enhanced debugging and forced flow triggers for all control methods
 */

'use strict';

const { Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");
const { getDataValue } = require('../../lib/TuyaHelpers');
const { ZEMISMART_4_GANG_DATA_POINTS } = require('../../lib/TuyaDataPoints');

Cluster.addCluster(TuyaSpecificCluster);

class ZemismartWallSwitch4Gang extends TuyaSpecificClusterDevice {

  getMyDp() {
    const { subDeviceId } = this.getData();
    switch(subDeviceId) {
      case 'secondGang': return 2;
      case 'thirdGang': return 3;
      case 'fourthGang': return 4;
      default: return 1;
    }
  }

  isMyDp(dp) {
    const { subDeviceId } = this.getData();
    
    if (this.isSubDevice()) {
      return dp === this.getMyDp();
    } else {
      return dp === 1 || dp === 14;
    }
  }

  async onNodeInit({ zclNode }) {
    this._zclNode = zclNode;
    this._rejoinState = {
      initTime: Date.now(),
      rejoinCount: 0,
      lastRejoinTime: null
    };
    
    this._momentaryTimer = null;
    this._originalState = null;
    
    this.log(`${this.getGangName()} initialized`);
    
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

    zclNode.endpoints[1].clusters.tuya.on("reporting", this.processDatapoint.bind(this));
    zclNode.endpoints[1].clusters.tuya.on("response", this.processDatapoint.bind(this));

    this._setupRejoinHandling();

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
    
    if (timeSinceLastRejoin < 30000) {
      return;
    }
    
    this._rejoinState.rejoinCount++;
    this._rejoinState.lastRejoinTime = timestamp;
    
    this.log(`${this.getGangName()} rejoined network - syncing states`);
    
    try {
      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      await this.sleep(2000);

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
      const gangDPs = [1, 2, 3, 4];
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
        const dps = [1, 2, 3, 4, 14];
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
      const switchMode = this.getSetting('switch_mode') || 'switch';
      
      // Log detalhado para depuração
      this.log(`${this.getGangName()} onoff command received, opts: ${JSON.stringify(opts)}`);
      this.log(`${this.getGangName()} onoff set to ${value} via ${opts.from || 'unknown'}`);
      
      // Capturar estado anterior antes da mudança
      const previousValue = this.getCapabilityValue('onoff') !== null ? this.getCapabilityValue('onoff') : !value;
      
      if (switchMode === 'momentary') {
        await this._handleMomentaryMode(value, previousValue);
      } else {
        await this.writeBool(dp, value);
        
        // Forçar atualização do estado e disparo do fluxo para todas as origens
        await this.setCapabilityValue('onoff', value);
        
        // Disparar fluxo se houve mudança real de estado
        if (previousValue !== value) {
          this.log(`${this.getGangName()} forcing state change flow trigger: ${previousValue} -> ${value}`);
          await this._triggerStateChangedFlow(previousValue, value);
        }
      }
      
      return true;
    } catch (err) {
      this.error(`Command failed: ${err.message}`);
      throw err;
    }
  }

  async _handleMomentaryMode(value, previousValue) {
    const dp = this.getMyDp();
    const momentaryTimeoutSeconds = this.getSetting('momentary_timeout') || 1;
    const momentaryTimeout = momentaryTimeoutSeconds * 1000;
    
    if (this._momentaryTimer) {
      clearTimeout(this._momentaryTimer);
      this._momentaryTimer = null;
    }
    
    try {
      await this.writeBool(dp, value);
      
      // Update capability and trigger flow for initial change
      await this.setCapabilityValue('onoff', value);
      
      // Disparar fluxo se houve mudança real de estado
      if (previousValue !== value) {
        this.log(`${this.getGangName()} momentary mode - triggering initial state change: ${previousValue} -> ${value}`);
        await this._triggerStateChangedFlow(previousValue, value);
      }
      
      this._originalState = previousValue; // Usar o estado anterior real
      
      this._momentaryTimer = setTimeout(async () => {
        try {
          await this.writeBool(dp, this._originalState);
          await this.setCapabilityValue('onoff', this._originalState);
          this.log(`${this.getGangName()} reverted to original state (${this._originalState}) after ${momentaryTimeoutSeconds}s`);
          
          // Trigger state_changed flow for reversion
          this.log(`${this.getGangName()} momentary mode - triggering reversion: ${value} -> ${this._originalState}`);
          await this._triggerStateChangedFlow(value, this._originalState);
        } catch (error) {
          this.error(`Failed to revert momentary state: ${error.message}`);
        }
        this._momentaryTimer = null;
        this._originalState = null;
      }, momentaryTimeout);
      
      this.log(`${this.getGangName()} momentary mode activated for ${momentaryTimeoutSeconds}s`);
      
    } catch (error) {
      if (this._momentaryTimer) {
        clearTimeout(this._momentaryTimer);
        this._momentaryTimer = null;
      }
      throw error;
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (!this.isSubDevice() && changedKeys.includes('power_on_behavior')) {
      const powerOnBehavior = newSettings.power_on_behavior;
      
      let enumValue;
      switch (powerOnBehavior) {
        case 'off': enumValue = 0; break;
        case 'on': enumValue = 1; break;
        case 'memory': enumValue = 2; break;
        default: throw new Error(`Invalid power-on behavior: ${powerOnBehavior}`);
      }

      await this.writeEnum(14, enumValue);
    }
    
    if (changedKeys.includes('switch_mode')) {
      const switchMode = newSettings.switch_mode;
      this.log(`${this.getGangName()} switch mode changed to: ${switchMode}`);
      
      if (this._momentaryTimer) {
        clearTimeout(this._momentaryTimer);
        this._momentaryTimer = null;
        this._originalState = null;
      }
    }
    
    if (changedKeys.includes('momentary_timeout')) {
      const timeoutSeconds = newSettings.momentary_timeout;
      this.log(`${this.getGangName()} momentary timeout changed to: ${timeoutSeconds}s`);
    }
  }

  async processDatapoint(data) {
    const dp = data.dp;
    const value = getDataValue(data);
    
    // Log detalhado para depuração de relatórios Zigbee
    this.log(`${this.getGangName()} received Zigbee datapoint - DP: ${dp}, Value: ${value}, My DP: ${this.getMyDp()}`);
    
    if (!this.isMyDp(dp)) {
      return;
    }

    switch (dp) {
      case 1:
      case 2:
      case 3:
      case 4:
        this.log(`${this.getGangName()} processing switch state datapoint ${dp}`);
        await this._updateOnOffState(value, dp);
        break;
        
      case 14:
        this.log(`${this.getGangName()} processing power-on behavior datapoint ${dp}`);
        await this._handleRelayStatusResponse(value);
        break;
        
      default:
        this.log(`${this.getGangName()} unknown datapoint ${dp} with value ${value}`);
        break;
    }
  }

  async _handleRelayStatusResponse(value) {
    if (this.isSubDevice()) return;
    
    let mode;
    switch (value) {
      case 0: mode = 'off'; break;
      case 1: mode = 'on'; break;
      case 2: mode = 'memory'; break;
      default: mode = 'unknown';
    }
    
    const currentSetting = this.getSetting('power_on_behavior');
    if (currentSetting !== mode && mode !== 'unknown') {
      try {
        await this.setSettings({ power_on_behavior: mode });
      } catch (error) {
        this.error(`Setting update failed: ${error.message}`);
      }
    }
  }

  async _updateOnOffState(value, dp) {
    const previousValue = this.getCapabilityValue('onoff') !== null ? this.getCapabilityValue('onoff') : false;
    
    try {
      if (previousValue !== value) {
        this.log(`${this.getGangName()} state updated from ${previousValue} to ${value} via Zigbee (DP: ${dp})`);
        await this.setCapabilityValue('onoff', value);
        
        // Trigger state_changed flow
        this.log(`${this.getGangName()} triggering Zigbee state change flow: ${previousValue} -> ${value}`);
        await this._triggerStateChangedFlow(previousValue, value);
      } else {
        this.log(`${this.getGangName()} Zigbee state unchanged: ${value} (DP: ${dp})`);
      }
    } catch (err) {
      this.error(`State update failed for ${this.getGangName()}: ${err.message}`);
    }
  }

  async _triggerStateChangedFlow(fromState, toState) {
    try {
      // Add debug logging
      this.log(`${this.getGangName()} triggering state changed with fromState: ${fromState} (${typeof fromState}), toState: ${toState} (${typeof toState})`);
      
      const tokens = { 
        fromState: fromState, 
        toState: toState 
      };
      const state = { 
        fromState: fromState, 
        toState: toState 
      };
      
      await this.driver.triggerStateChanged(this, tokens, state);
      this.log(`${this.getGangName()} triggered state changed flow: ${fromState} -> ${toState}`);
    } catch (error) {
      this.error(`Failed to trigger state changed flow: ${error.message}`);
    }
  }

  getGangName() {
    const { subDeviceId } = this.getData();
    switch(subDeviceId) {
      case 'secondGang': return 'Gang 2';
      case 'thirdGang': return 'Gang 3';
      case 'fourthGang': return 'Gang 4';
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
    if (this._momentaryTimer) {
      clearTimeout(this._momentaryTimer);
      this._momentaryTimer = null;
    }
    
    if (this._zclNode) {
      this._zclNode.removeAllListeners('online');
      this._zclNode.removeAllListeners('announce');
    }
    
    super.onDeleted();
  }
}

module.exports = ZemismartWallSwitch4Gang;