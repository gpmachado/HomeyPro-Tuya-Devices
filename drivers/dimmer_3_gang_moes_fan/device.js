/**
 * File: device.js - MOES 3-Gang Fan Controller
 * Version: 1.5.0 - Enhanced Sync & State Management
 * Author: Based on working 2-gang pattern + fan optimizations
 * 
 * Key features:
 * - Fan-specific debounce (800ms for speed changes)
 * - Motor protection with startup sequence
 * - Simplified error handling
 * - No flow cards, no countdown logic
 * - Mobile-friendly interface
 */

'use strict';

const { debug, Cluster } = require('zigbee-clusters');
const TuyaSpecificCluster = require('../../lib/TuyaSpecificCluster');
const TuyaSpecificClusterDevice = require('../../lib/TuyaSpecificClusterDevice');
const { getDataValue } = require('../../lib/TuyaHelpers');

Cluster.addCluster(TuyaSpecificCluster);

class Fan3GangMoes extends TuyaSpecificClusterDevice {
  
  // Inline DataPoints - communication protocol with device
  static get DATA_POINTS() {
    return {
      // Gang 1 Controls
      onOffGangOne: 1,
      brightnessGangOne: 2,
      minimumBrightnessGangOne: 3,
      maximumBrightnessGangOne: 5,
      
      // Gang 2 Controls
      onOffGangTwo: 7,
      brightnessGangTwo: 8,
      minimumBrightnessGangTwo: 9,
      maximumBrightnessGangTwo: 11,
      
      // Gang 3 Controls
      onOffGangThree: 15,
      brightnessGangThree: 16,
      minimumBrightnessGangThree: 17,
      maximumBrightnessGangThree: 19,
      
      // Global Settings
      powerOnStatusSetting: 14,
      backlightMode: 21
    };
  }

  // Device initialization
  async onNodeInit({ zclNode }) {
    this.printNode();

    const { subDeviceId } = this.getData();
    this._gangName = this._getGangName(subDeviceId);
    this._gangNumber = this._getGangNumber(subDeviceId);
    this._isMainDevice = !this.isSubDevice();
    
    this.log(`${this._gangName} Fan Controller v1.5.0 initialized`);

    // Fan-specific configuration
    this.FAN_DEBOUNCE_DELAY = 800;
    this.MOTOR_STARTUP_DELAY = 1500;
    this.MIN_FAN_SPEED = 0.1;

    // Individual debounce timer per gang
    this.fanSpeedTimer = null;

    // State recovery for sync issues
    if (this._isMainDevice) {
      this._stateRecovery = {
        active: false,
        startTime: null,
        expectedDPs: [1, 2, 7, 8, 15, 16], // All main DPs
        receivedDPs: new Set(),
        timeout: 8000
      };
    }

    // Read device firmware info
    try {
      const attributes = await zclNode.endpoints[1].clusters.basic
        .readAttributes(['appVersion', 'manufacturerName', 'modelId']);
      if (attributes.appVersion) {
        await this.setStoreValue('firmwareVersion', attributes.appVersion);
        this.log(`${this._gangName} firmware version:`, attributes.appVersion);
      }
    } catch (err) {
      this.error(`${this._gangName} error reading device attributes:`, err);
    }

    // Setup gang-specific capabilities
    const dpConfig = this._getDpConfig();
    await this._setupGang(dpConfig.onOffDp, dpConfig.speedDp);
    await this._readInitialState(dpConfig.onOffDp, dpConfig.speedDp);

    // Setup Tuya listeners once per physical device
    if (!this.hasListenersAttached) {
      this._setupTuyaListeners(zclNode);
      this.hasListenersAttached = true;
    }

    // Initialize power-on behavior for main device only
    if (this._isMainDevice) {
      await this._setPowerOnBehavior();
      
      // Start state recovery to ensure sync
      setTimeout(() => {
        this._startStateRecovery();
      }, 2000);
    }

    this.log(`${this._gangName} initialization complete`);
  }

  // Helper methods
  _getGangName(subDeviceId) {
    switch(subDeviceId) {
      case 'secondGang': return 'Fan Gang 2';
      case 'thirdGang': return 'Fan Gang 3';
      default: return 'Fan Gang 1';
    }
  }

  _getGangNumber(subDeviceId) {
    switch(subDeviceId) {
      case 'secondGang': return 2;
      case 'thirdGang': return 3;
      default: return 1;
    }
  }

  _getDpConfig() {
    const DP = this.constructor.DATA_POINTS;
    switch(this._gangNumber) {
      case 2:
        return { 
          onOffDp: DP.onOffGangTwo, 
          speedDp: DP.brightnessGangTwo,
          minSpeedDp: DP.minimumBrightnessGangTwo,
          maxSpeedDp: DP.maximumBrightnessGangTwo
        };
      case 3:
        return { 
          onOffDp: DP.onOffGangThree, 
          speedDp: DP.brightnessGangThree,
          minSpeedDp: DP.minimumBrightnessGangThree,
          maxSpeedDp: DP.maximumBrightnessGangThree
        };
      default:
        return { 
          onOffDp: DP.onOffGangOne, 
          speedDp: DP.brightnessGangOne,
          minSpeedDp: DP.minimumBrightnessGangOne,
          maxSpeedDp: DP.maximumBrightnessGangOne
        };
    }
  }

  _isMyDp(dp) {
    const config = this._getDpConfig();
    const DP = this.constructor.DATA_POINTS;
    
    if (this._isMainDevice) {
      return dp === config.onOffDp || dp === config.speedDp || 
             dp === config.minSpeedDp || dp === config.maxSpeedDp ||
             dp === DP.powerOnStatusSetting || dp === DP.backlightMode;
    } else {
      return dp === config.onOffDp || dp === config.speedDp || 
             dp === config.minSpeedDp || dp === config.maxSpeedDp;
    }
  }

  // Tuya communication listeners with better sync handling
  _setupTuyaListeners(zclNode) {
    this.log(`${this._gangName} setting up Tuya listeners`);
    
    // Physical device events (button presses, etc)
    zclNode.endpoints[1].clusters.tuya.on('reporting', async (value) => {
      try {
        await this.processDatapoint(value, 'PHYSICAL');
      } catch (err) {
        this.error(`${this._gangName} error processing reporting:`, err);
      }
    });

    // App command responses
    zclNode.endpoints[1].clusters.tuya.on('response', async (value) => {
      try {
        await this.processDatapoint(value, 'APP');
      } catch (err) {
        this.error(`${this._gangName} error processing response:`, err);
      }
    });

    // Network events for better sync
    zclNode.on('online', () => {
      this.log(`${this._gangName} device online`);
      if (this._isMainDevice) {
        setTimeout(() => this._startStateRecovery(), 1000);
      }
    });

    zclNode.on('offline', () => {
      this.log(`${this._gangName} device offline`);
    });
  }

  // Capability setup with fan-specific logic
  async _setupGang(dpOnOff, dpSpeed) {
    // OnOff capability with enhanced sync
    this.registerCapabilityListener('onoff', async (value) => {
      this.log(`${this._gangName} onoff command:`, value);
      
      // Enhanced sync check - prevent unnecessary commands
      const currentState = this.getCapabilityValue('onoff');
      if (currentState === value) {
        this.log(`${this._gangName} onoff already ${value}, skipping command`);
        return true;
      }
      
      // Clear pending speed timer
      if (this.fanSpeedTimer) {
        clearTimeout(this.fanSpeedTimer);
        this.fanSpeedTimer = null;
      }
      
      if (!value) {
        // Turn off fan completely
        await this._writeCommand(dpOnOff, false, 'bool');
        await this.setCapabilityValue('dim', 0);
        await this._writeCommand(dpSpeed, 0, 'data32');
      } else {
        // Turn on fan with appropriate speed
        const currentDim = this.getCapabilityValue('dim');
        const targetSpeed = currentDim > 0 ? currentDim : this.MIN_FAN_SPEED;
        
        await this._writeCommand(dpOnOff, true, 'bool');
        
        if (currentDim === 0) {
          this.log(`${this._gangName} starting from 0, setting minimum speed`);
          await this.setCapabilityValue('dim', targetSpeed);
          setTimeout(async () => {
            await this._writeCommand(dpSpeed, Math.round(targetSpeed * 1000), 'data32');
          }, 200);
        }
      }
    });

    // Dim capability with debouncing
    this.registerCapabilityListener('dim', async (value) => {
      const level = Math.round(value * 1000);
      this.log(`${this._gangName} fan speed: ${Math.round(value * 100)}%`);
      
      if (this.fanSpeedTimer) {
        clearTimeout(this.fanSpeedTimer);
      }
      
      const currentOnOff = this.getCapabilityValue('onoff');
      const isGoingToZero = level === 0;
      const isStartingFromZero = !currentOnOff && level > 0;
      
      const debounceDelay = isStartingFromZero ? this.MOTOR_STARTUP_DELAY : this.FAN_DEBOUNCE_DELAY;
      
      this.fanSpeedTimer = setTimeout(async () => {
        try {
          this.log(`${this._gangName} executing speed: ${Math.round(value * 100)}%`);
          
          if (level > 0) {
            if (isStartingFromZero) {
              this.log(`${this._gangName} motor startup sequence`);
              await this.setCapabilityValue('onoff', true);
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            await this._writeCommand(dpSpeed, level, 'data32');
            
            if (!this.getCapabilityValue('onoff')) {
              await this.setCapabilityValue('onoff', true);
            }
          } else {
            this.log(`${this._gangName} stopping motor`);
            await this._writeCommand(dpOnOff, false, 'bool');
            await this.setCapabilityValue('onoff', false);
            await this._writeCommand(dpSpeed, 0, 'data32');
          }
        } catch (err) {
          this.error(`${this._gangName} error in speed command:`, err);
          throw err;
        } finally {
          this.fanSpeedTimer = null;
        }
      }, debounceDelay);
    });
  }

  // Read and set initial state
  async _readInitialState(dpOnOff, dpSpeed) {
    try {
      this.log(`${this._gangName} reading initial state`);
      
      let onOffStateValue = this.getStoreValue(`dp${dpOnOff}_value`) || false;
      let speedStateValue = this.getStoreValue(`dp${dpSpeed}_value`) || 0;
      
      await this.setCapabilityValue("onoff", onOffStateValue).catch(this.error);
      await this.setCapabilityValue("dim", speedStateValue / 1000).catch(this.error);
      
      this.log(`${this._gangName} initial state loaded`);
    } catch (err) {
      this.error(`${this._gangName} error reading initial state:`, err);
    }
  }

  // Process incoming datapoints with better sync tracking
  async processDatapoint(data, source = 'UNKNOWN') {
    const dp = data.dp;
    const parsedValue = getDataValue(data);
    
    if (!this._isMyDp(dp)) {
      return;
    }

    // Check if this is a duplicate value to reduce log spam
    const lastValueKey = `lastDP${dp}Value`;
    const lastValue = this.getStoreValue(lastValueKey);
    const isDuplicate = lastValue === parsedValue;

    if (!isDuplicate) {
      this.log(`${this._gangName} DP ${dp} value: ${parsedValue} (${source})`);
    }

    await this.setStoreValue(`dp${dp}_value`, parsedValue).catch(this.error);
    await this.setStoreValue(lastValueKey, parsedValue).catch(this.error);

    const config = this._getDpConfig();
    const DP = this.constructor.DATA_POINTS;
    
    if (dp === config.onOffDp) {
      await this._handleOnOffState(parsedValue, source);
    } else if (dp === config.speedDp) {
      await this._handleSpeedState(parsedValue, source);
    } else if (dp === config.minSpeedDp) {
      const minSpeed = Math.round((parsedValue / 1000) * 100);
      if (!isDuplicate) {
        this.log(`${this._gangName} minimum speed: ${minSpeed}%`);
      }
    } else if (dp === config.maxSpeedDp) {
      const maxSpeed = Math.round((parsedValue / 1000) * 100);
      if (!isDuplicate) {
        this.log(`${this._gangName} maximum speed: ${maxSpeed}%`);
      }
    } else if (dp === DP.powerOnStatusSetting && this._isMainDevice) {
      const powerOnMap = { 0: 'off', 1: 'on', 2: 'memory' };
      const state = powerOnMap[parsedValue];
      if (state && !isDuplicate) {
        await this.setStoreValue('powerOnState', state);
        this.log(`${this._gangName} power on state: ${state}`);
      }
    } else if (dp === DP.backlightMode && this._isMainDevice) {
      const backlightMap = { 0: 'off', 1: 'normal', 2: 'inverted' };
      const mode = backlightMap[parsedValue];
      if (mode && !isDuplicate) {
        await this.setStoreValue('backlightMode', mode);
        this.log(`${this._gangName} backlight mode: ${mode}`);
      }
    }

    // Track for state recovery
    if (this._isMainDevice && this._stateRecovery.active) {
      this._stateRecovery.receivedDPs.add(dp);
      this._checkStateRecoveryComplete();
    }
  }

  // Enhanced state handlers with better sync
  async _handleOnOffState(parsedValue, source = 'UNKNOWN') {
    const newValue = parsedValue === true || parsedValue === 1;
    const currentValue = this.getCapabilityValue("onoff");
    
    if (currentValue !== newValue) {
      this.log(`${this._gangName} sync onoff: ${currentValue} -> ${newValue} (${source})`);
      await this.setCapabilityValue("onoff", newValue).catch(this.error);
    }
  }

  async _handleSpeedState(parsedValue, source = 'UNKNOWN') {
    const dimValue = Math.max(0, Math.min(1, parsedValue / 1000));
    const currentValue = this.getCapabilityValue("dim");
    
    if (Math.abs(currentValue - dimValue) > 0.001) {
      this.log(`${this._gangName} sync speed: ${Math.round(currentValue * 100)}% -> ${Math.round(dimValue * 100)}% (${source})`);
      await this.setCapabilityValue("dim", dimValue).catch(this.error);
      
      // Auto-sync onoff state based on speed
      const shouldBeOn = dimValue > 0;
      const currentOnOff = this.getCapabilityValue('onoff');
      if (currentOnOff !== shouldBeOn) {
        this.log(`${this._gangName} auto-sync onoff: ${currentOnOff} -> ${shouldBeOn}`);
        await this.setCapabilityValue('onoff', shouldBeOn).catch(this.error);
      }
    }
  }

  // Command writing with error handling
  async _writeCommand(dp, value, type) {
    try {
      if (type === 'bool') {
        return await this.writeBool(dp, value);
      } else if (type === 'data32') {
        return await this.writeData32(dp, value);
      } else if (type === 'enum') {
        return await this.writeEnum(dp, value);
      } else {
        throw new Error(`Unsupported write type: ${type}`);
      }
    } catch (err) {
      this.error(`${this._gangName} failed to write DP ${dp}:`, err.message);
      throw err;
    }
  }

  // Power-on behavior setup
  async _setPowerOnBehavior() {
    const DP = this.constructor.DATA_POINTS;
    const currentPowerOnState = this.getStoreValue('powerOnState') || 'memory';
    const powerOnValue = { off: 0, on: 1, memory: 2 }[currentPowerOnState];
    
    try {
      await this._writeCommand(DP.powerOnStatusSetting, powerOnValue, 'enum');
      this.log(`${this._gangName} power on state set: ${currentPowerOnState}`);
    } catch (err) {
      this.error(`${this._gangName} error setting power on state:`, err);
    }
  }

  // Settings management
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log(`${this._gangName} settings changed:`, changedKeys);

    // Validate speed limits
    if (changedKeys.includes('minimumBrightness') || changedKeys.includes('maximumBrightness')) {
      const minSpeed = changedKeys.includes('minimumBrightness') ? 
        newSettings.minimumBrightness : (oldSettings.minimumBrightness || 10);
      const maxSpeed = changedKeys.includes('maximumBrightness') ? 
        newSettings.maximumBrightness : (oldSettings.maximumBrightness || 100);
      
      if (minSpeed >= maxSpeed) {
        throw new Error(`Min speed (${minSpeed}%) must be less than max speed (${maxSpeed}%)`);
      }
    }

    const config = this._getDpConfig();
    
    // Handle minimum speed
    if (changedKeys.includes('minimumBrightness')) {
      const newMin = newSettings.minimumBrightness;
      const minValue = Math.round((newMin / 100) * 1000);
      
      try {
        await this._writeCommand(config.minSpeedDp, minValue, 'data32');
        this.log(`${this._gangName} minimum speed set: ${newMin}%`);
      } catch (err) {
        this.error(`${this._gangName} error setting minimum speed:`, err);
        throw new Error(`Failed to set minimum speed: ${err.message}`);
      }
    }

    // Handle maximum speed
    if (changedKeys.includes('maximumBrightness')) {
      const newMax = newSettings.maximumBrightness;
      const maxValue = Math.round((newMax / 100) * 1000);
      
      try {
        await this._writeCommand(config.maxSpeedDp, maxValue, 'data32');
        this.log(`${this._gangName} maximum speed set: ${newMax}%`);
      } catch (err) {
        this.error(`${this._gangName} error setting maximum speed:`, err);
        throw new Error(`Failed to set maximum speed: ${err.message}`);
      }
    }

    // Handle power-on behavior (main device only)
    if (changedKeys.includes('powerOnState') && this._isMainDevice) {
      await this._setPowerOnBehavior();
    }

    // Handle backlight mode (main device only)
    if (changedKeys.includes('backlightMode') && this._isMainDevice) {
      const DP = this.constructor.DATA_POINTS;
      const backlightValue = { off: 0, normal: 1, inverted: 2 }[newSettings.backlightMode];
      
      if (backlightValue !== undefined) {
        try {
          await this._writeCommand(DP.backlightMode, backlightValue, 'enum');
          this.log(`${this._gangName} backlight mode set: ${newSettings.backlightMode}`);
        } catch (err) {
          this.error(`${this._gangName} error setting backlight mode:`, err);
        }
      }
    }
  }

  // State recovery system for better sync
  _startStateRecovery() {
    if (!this._isMainDevice) return;

    this.log(`${this._gangName} starting state recovery for sync`);
    this._stateRecovery.active = true;
    this._stateRecovery.startTime = Date.now();
    this._stateRecovery.receivedDPs.clear();

    // Set timeout to finish recovery
    setTimeout(() => {
      if (this._stateRecovery.active) {
        this._finishStateRecovery();
      }
    }, this._stateRecovery.timeout);
  }

  _checkStateRecoveryComplete() {
    if (!this._stateRecovery.active) return;

    // Check if we received enough DPs for basic sync
    const criticalDPs = [1, 2, 7, 8, 15, 16]; // OnOff and Speed for all gangs
    const receivedCritical = criticalDPs.filter(dp => 
      this._stateRecovery.receivedDPs.has(dp)
    );

    if (receivedCritical.length >= 4) { // At least 2 gangs worth of data
      this._finishStateRecovery();
    }
  }

  _finishStateRecovery() {
    if (!this._stateRecovery.active) return;

    const duration = Date.now() - this._stateRecovery.startTime;
    const received = Array.from(this._stateRecovery.receivedDPs);
    
    this.log(`${this._gangName} state recovery complete: ${duration}ms, DPs: ${received.join(',')}`);
    this._stateRecovery.active = false;
  }

  // Cleanup
  onDeleted() {
    this.log(`${this._gangName} Fan Controller v1.5.0 removed`);
    
    if (this.fanSpeedTimer) {
      clearTimeout(this.fanSpeedTimer);
    }
  }
}

module.exports = Fan3GangMoes;