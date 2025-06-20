/**
 * File: device.js
 * Device: Zemismart Wall Switch 3 Gang
 * Version: 3.3.0
 * Date: 2025-06-18
 * Author: Standardized version aligned with Zemismart family
 * 
 * Description:
 * - Enhanced ZigBee device for Zemismart 3-gang wall switches
 * - Supports TS0003 firmware with standard OnOff clusters
 * - Sub-device management via physical endpoints
 * - Backlight and power-on behavior settings (main device only)
 * - State synchronization after power recovery
 * 
 * Features:
 * - Standard ZigBee OnOff cluster communication
 * - Multi-endpoint support (1,2,3)
 * - Settings restricted to main device only
 * - Consistent with TS0001/TS0002 family behavior
 */

'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER, Cluster } = require('zigbee-clusters');
const TuyaOnOffCluster = require('../../lib/TuyaOnOffCluster');

// Register custom cluster
Cluster.addCluster(TuyaOnOffCluster);

class ZemismartWallSwitch3Gang extends ZigBeeDevice {

  /**
   * Device initialization
   * @param {Object} options - Initialization options
   * @param {Object} options.zclNode - ZigBee cluster library node
   */
  async onNodeInit({zclNode}) {
    this.printNode();

    const { subDeviceId } = this.getData();
    const endpoint = subDeviceId === 'secondSwitch' ? 2 : subDeviceId === 'thirdSwitch' ? 3 : 1;
    const switchName = subDeviceId ? `Switch ${subDeviceId.replace('Switch', '')}` : 'Gang 1';
    
    this.log(`Zemismart Wall Switch 3 Gang v3.3.0 initialized - ${switchName}`);

    // Initialize state tracking
    this._lastKnownState = null;
    this._isInitializing = true;
    this._endpoint = endpoint;
    this._isMainDevice = !subDeviceId;

    // Register capability with standard reporting
    this.registerCapability('onoff', CLUSTER.ON_OFF, {
      reportOpts: {
        configureAttributeReporting: {
          minInterval: 60,
          maxInterval: 600,
          minChange: 0
        }
      },
      endpoint: endpoint
    });

    // Listen for state changes from device
    this.zclNode.endpoints[endpoint].clusters.onOff.on('attr.onOff', (value) => {
      this._handleDeviceStateChange(value);
    });

    // Initialize device settings (only for main device - endpoint 1)
    if (this._isMainDevice) {
      await this._initializeSettings();
    }

    // Read basic attributes (only for main device)
    if (this._isMainDevice) {
      await zclNode.endpoints[1].clusters.basic.readAttributes([
        'manufacturerName', 'zclVersion', 'appVersion', 'modelId', 'powerSource', 'attributeReportingStatus'
      ]).catch(err => {
        this.error('Error when reading device attributes:', err.message);
      });
    }

    // Initial state sync
    await this._syncDeviceState();
    
    // Set up state verification
    this._setupStateVerification();

    this._isInitializing = false;
  }

  /**
   * Initialize device settings (backlight and power-on behavior only)
   * Removed indicator_mode to match TS0001/TS0002 consistency
   */
  async _initializeSettings() {
    if (!this._isMainDevice) return;
    
    try {
      // Initialize backlight setting
      await this._initializeBacklight();
      
      // Initialize power-on behavior
      await this._initializePowerOnBehavior();
      
    } catch (error) {
      this.error('Error initializing settings:', error.message);
    }
  }

  /**
   * Initialize backlight control
   */
  async _initializeBacklight() {
    try {
      const result = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['backlightControl']);
      
      let backlightEnabled = true; // Default
      
      if (result.backlightControl !== undefined) {
        backlightEnabled = result.backlightControl !== 0;
      }
      
      await this.setSettings({ backlight_enabled: backlightEnabled });
      
    } catch (error) {
      // Silent fallback - no debug log
      await this.setSettings({ backlight_enabled: true });
    }
  }

  /**
   * Initialize power-on behavior
   */
  async _initializePowerOnBehavior() {
    try {
      const result = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['relayStatus']);
      
      let powerOnValue = '2'; // Default: Restore
      
      if (result.relayStatus !== undefined) {
        if (typeof result.relayStatus === 'string') {
          const stateMap = { 'Off': '0', 'On': '1', 'Remember': '2' };
          powerOnValue = stateMap[result.relayStatus] || '2';
        } else {
          powerOnValue = result.relayStatus.toString();
        }
      }
      
      await this.setSettings({ power_on_behavior: powerOnValue });
      
    } catch (error) {
      // Silent fallback - no debug log
      await this.setSettings({ power_on_behavior: '2' });
    }
  }

  /**
   * Handle state changes from device
   * @param {boolean} newState - New device state
   */
  _handleDeviceStateChange(newState) {
    if (this._isInitializing) {
      return;
    }
    
    // Update Homey capability if different
    const currentHomeyState = this.getCapabilityValue('onoff');
    if (newState !== currentHomeyState) {
      this.setCapabilityValue('onoff', newState).catch(err => {
        this.error('Error updating Homey capability:', err);
      });
    }
    
    this._lastKnownState = newState;
  }

  /**
   * Sync device state with Homey capability
   */
  async _syncDeviceState() {
    try {
      const result = await this.zclNode.endpoints[this._endpoint].clusters.onOff.readAttributes(['onOff'], {
        timeout: 10000
      });
      
      if (result.onOff !== undefined) {
        const deviceState = result.onOff;
        const homeyState = this.getCapabilityValue('onoff');
        
        if (deviceState !== homeyState) {
          await this.setCapabilityValue('onoff', deviceState);
          
          // Trigger capability listener to ensure flows are triggered
          this.triggerCapabilityListener('onoff', deviceState).catch(err => {
            // Silent error handling
          });
        }
        
        this._lastKnownState = deviceState;
        return deviceState;
      }
      
    } catch (error) {
      this.error('Error syncing device state:', error.message);
    }
  }

  /**
   * Set up state verification monitoring
   */
  _setupStateVerification() {
    // Monitor first communication after silence
    let lastCommunication = Date.now();
    
    const updateLastCommunication = () => {
      const now = Date.now();
      const timeSinceLastComm = now - lastCommunication;
      
      // If more than 30 seconds since last communication, likely rejoined
      if (timeSinceLastComm > 30000) {
        setTimeout(async () => {
          try {
            await this._syncDeviceState();
          } catch (error) {
            this.error('Error syncing state after communication gap:', error.message);
          }
        }, 1000);
      }
      
      lastCommunication = now;
    };

    // Monitor attribute changes
    this.zclNode.endpoints[this._endpoint].clusters.onOff.on('attr.onOff', () => {
      updateLastCommunication();
    });

    // Monitor any response from device
    this.zclNode.endpoints[this._endpoint].clusters.onOff.on('response', () => {
      updateLastCommunication();
    });

    // Monitor availability changes
    this.on('$available', (available) => {
      if (available) {
        setTimeout(async () => {
          try {
            await this._syncDeviceState();
          } catch (error) {
            this.error('Error syncing state after availability:', error.message);
          }
        }, 2000);
      }
    });
  }

  /**
   * Override getSettings to hide settings from sub-devices
   * @returns {Object} Settings object (empty for sub-devices)
   */
  getSettings() {
    // Sub-devices do NOT show any settings
    if (this.isSubDevice()) {
      return {}; // Returns empty = no settings appear in UI
    }
    
    // Main device shows all settings normally
    return super.getSettings();
  }

  /**
   * Handle settings changes - only for main device
   * Removed indicator_mode handling to match family consistency
   * @param {Object} options - Settings change options
   */
  async onSettings({oldSettings, newSettings, changedKeys}) {
    // Completely ignore settings changes on sub-devices
    if (this.isSubDevice()) {
      return;
    }
    
    try {
      // Handle backlight changes
      if (changedKeys.includes('backlight_enabled')) {
        const backlightEnabled = newSettings.backlight_enabled;
        this.log(`Backlight ${backlightEnabled ? 'enabled' : 'disabled'}`);
        
        const deviceValue = backlightEnabled ? 1 : 0;
        await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ 
          backlightControl: deviceValue 
        });
      }
      
      // Handle power-on behavior changes
      if (changedKeys.includes('power_on_behavior')) {
        const powerOnValue = parseInt(newSettings.power_on_behavior);
        this.log(`Power-on behavior updated to: ${powerOnValue}`);
        
        await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ 
          relayStatus: powerOnValue 
        });
      }
      
    } catch (error) {
      this.error('Failed to apply settings:', error.message);
      throw new Error(`Failed to apply settings: ${error.message}`);
    }
  }

  /**
   * Override capability listener to track state changes from Homey
   * @param {boolean} value - Target on/off state
   * @param {Object} opts - Additional options
   * @returns {boolean} Success status
   */
  async onCapabilityOnoff(value, opts) {
    try {
      const result = await super.onCapabilityOnoff(value, opts);
      this._lastKnownState = value;
      return result;
    } catch (error) {
      this.error('Error in onCapabilityOnoff:', error);
      throw error;
    }
  }

  /**
   * Device cleanup
   */
  onDeleted() {
    const { subDeviceId } = this.getData();
    const switchName = subDeviceId ? `Switch ${subDeviceId.replace('Switch', '')}` : 'Main Switch';
    this.log(`Zemismart Wall Switch 3 Gang removed - ${switchName}`);
    super.onDeleted();
  }

  /**
   * Handle device availability
   */
  async onAvailable() {
    super.onAvailable();
    
    setTimeout(async () => {
      try {
        await this._syncDeviceState();
      } catch (error) {
        this.error('Error syncing state after device came online:', error.message);
      }
    }, 3000);
  }

  /**
   * Check if this is a sub-device
   * @returns {boolean} True if this is a sub-device
   */
  isSubDevice() {
    return !!this.getData().subDeviceId;
  }
}

module.exports = ZemismartWallSwitch3Gang;