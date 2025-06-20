/**
 * File: device.js
 * Device: Zemismart Wall Switch 1 Gang
 * Version: 3.3.0
 * Date: 2025-06-18
 * Author: Standardized version aligned with Zemismart family
 * 
 * Description:
 * - Enhanced ZigBee device for Zemismart 1-gang wall switches
 * - Supports TS0001 firmware with standard OnOff clusters
 * - Backlight and power-on behavior settings
 * - State synchronization after power recovery
 * - Debug logs disabled for production use
 * 
 * Features:
 * - Standard ZigBee OnOff cluster communication
 * - Single endpoint support
 * - Power outage recovery synchronization
 * - Production-ready logging level
 */

'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER, Cluster } = require('zigbee-clusters');
const TuyaOnOffCluster = require('../../lib/TuyaOnOffCluster');

// Register custom cluster
Cluster.addCluster(TuyaOnOffCluster);

class ZemismartWallSwitch1Gang extends ZigBeeDevice {

  async onNodeInit({zclNode}) {
    this.printNode();
    this.log('Zemismart Wall Switch 1 Gang v3.3.0 initialized');

    // Initialize state tracking
    this._lastKnownState = null;
    this._isInitializing = true;
    
    // Register capabilities
    this.registerCapability('onoff', CLUSTER.ON_OFF, {
      reportOpts: {
        configureAttributeReporting: {
          minInterval: 60,
          maxInterval: 600,
          minChange: 0
        }
      },
      endpoint: 1
    });

    // Listen for state changes from device
    this.zclNode.endpoints[1].clusters.onOff.on('attr.onOff', (value) => {
      this._handleDeviceStateChange(value);
    });

    // Initialize device settings
    await this._initializeSettings();
    
    // Read and sync current device state
    await this._syncDeviceState();
    
    // Set up state verification
    this._setupStateVerification();

    this._isInitializing = false;
  }

  /**
   * Initialize device settings (backlight and power-on behavior)
   */
  async _initializeSettings() {
    try {
      await this._initializeBacklight();
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
   * Sync device state with Homey capability - force read from device
   */
  async _syncDeviceState() {
    try {
      // Force read from device (not cache)
      const result = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['onOff'], {
        timeout: 10000
      });
      
      if (result.onOff !== undefined) {
        const deviceState = result.onOff;
        const homeyState = this.getCapabilityValue('onoff');
        
        // Always update Homey to match device (device is source of truth after rejoin)
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
      throw error;
    }
  }

  /**
   * Handle state changes from device
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
   * Set up state verification
   */
  _setupStateVerification() {
    // Monitor first communication after silence
    let lastCommunication = Date.now();
    
    // Update communication timestamp on any device interaction
    const updateLastCommunication = () => {
      const now = Date.now();
      const timeSinceLastComm = now - lastCommunication;
      
      // If more than 30 seconds since last communication, likely rejoined
      if (timeSinceLastComm > 30000) {
        setTimeout(async () => {
          try {
            await this._syncDeviceState();
          } catch (error) {
            this.error('Error syncing state after gap:', error.message);
          }
        }, 1000);
      }
      
      lastCommunication = now;
    };

    // Monitor attribute changes
    this.zclNode.endpoints[1].clusters.onOff.on('attr.onOff', () => {
      updateLastCommunication();
    });

    // Monitor any response from device
    this.zclNode.endpoints[1].clusters.onOff.on('response', () => {
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
   * Handle settings changes
   */
  async onSettings({oldSettings, newSettings, changedKeys}) {
    try {
      // Handle backlight changes
      if (changedKeys.includes('backlight_enabled')) {
        const backlightEnabled = newSettings.backlight_enabled;
        const deviceValue = backlightEnabled ? 1 : 0;
        await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ 
          backlightControl: deviceValue 
        });
        this.log(`Backlight ${backlightEnabled ? 'enabled' : 'disabled'}`);
      }
      
      // Handle power-on behavior changes
      if (changedKeys.includes('power_on_behavior')) {
        const powerOnValue = parseInt(newSettings.power_on_behavior);
        await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ 
          relayStatus: powerOnValue 
        });
        this.log(`Power-on behavior updated to: ${powerOnValue}`);
      }
      
    } catch (error) {
      this.error('Failed to apply settings:', error);
      throw new Error(`Failed to apply settings: ${error.message}`);
    }
  }

  /**
   * Override capability listener to track state changes from Homey
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
    this.log('Zemismart Wall Switch 1 Gang removed');
    super.onDeleted();
  }

  /**
   * Handle device unavailable/available events
   */
  onUnavailable() {
    super.onUnavailable();
  }

  async onAvailable() {
    super.onAvailable();
    
    // Force immediate state sync when device comes back online
    setTimeout(async () => {
      try {
        await this._syncDeviceState();
      } catch (error) {
        this.error('Error syncing state after device came online:', error.message);
      }
    }, 3000);
  }
}

module.exports = ZemismartWallSwitch1Gang;