/**
 * File: TuyaOnOffCluster.js - Enhanced OnOff Cluster for Zemismart Switches
 * Version: 3.2.0 - Fixed with indicatorMode + standardization
 * Author: Enhanced for Homey Pro
 */

'use strict';

const { ZCLDataTypes, OnOffCluster } = require('zigbee-clusters');

// Define custom data types for Tuya attributes
ZCLDataTypes.enum8IndicatorMode = ZCLDataTypes.enum8({
  Off: 0x00,        // LED always OFF
  Normal: 0x01,     // LED follows switch state  
  Reverse: 0x02     // LED opposite to switch state
});

ZCLDataTypes.enum8RelayStatus = ZCLDataTypes.enum8({
  Off: 0x00,        // Always start OFF after power restoration
  On: 0x01,         // Always start ON after power restoration  
  Remember: 0x02    // Restore previous state after power restoration
});

/**
 * Extended OnOff cluster with Tuya-specific attributes
 */
class TuyaOnOffCluster extends OnOffCluster {

  static get ATTRIBUTES() {
    return {
      ...super.ATTRIBUTES,
      
      // Physical backlight control at 0x5000
      backlightControl: {
        id: 0x5000,
        type: ZCLDataTypes.enum8IndicatorMode
      },
      
      // Power-on behavior at 0x8002
      relayStatus: { 
        id: 0x8002, 
        type: ZCLDataTypes.enum8RelayStatus 
      },

      // ✅ CORREÇÃO: Indicator mode para 3 Gang (ID único)
      indicatorMode: {
        id: 0x8003,
        type: ZCLDataTypes.enum8IndicatorMode
      }
    };
  }
}

// Export constants with consistent naming
TuyaOnOffCluster.BACKLIGHT_MODES = {
  OFF: 0x00,
  NORMAL: 0x01,
  REVERSE: 0x02
};

TuyaOnOffCluster.RELAY_STATUS = {
  OFF: 0x00,
  ON: 0x01,
  REMEMBER: 0x02  // ✅ Padronizado para "REMEMBER"
};

TuyaOnOffCluster.INDICATOR_MODES = {
  OFF: 0x00,
  NORMAL: 0x01,
  REVERSE: 0x02
};

module.exports = TuyaOnOffCluster;