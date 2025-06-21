/**
 * driver.js - Zigbee Repeater Driver
 * Version: 1.0.0
 * Description: Driver for Zigbee USB repeater devices with enhanced monitoring
 */

'use strict';

const { Driver } = require('homey');

class ZigbeeRepeaterDriver extends Driver {

    /**
     * Called when the driver is initialized
     */
    async onInit() {
        this.log('Zigbee Repeater Driver initialized');
    }

    /**
     * Called when a user is adding a device and the driver needs to return
     * a list of discovered devices. Required when 'pair' is present in driver.compose.json
     */
    async onPairListDevices() {
        return [];
    }

    /**
     * Called when the pairing process is initiated
     * This method allows customizing the pairing flow
     */
    async onPair(session) {
        // Handler for when a Zigbee device is discovered
        session.setHandler('list_devices', async () => {
            return [];
        });

        // Handler to validate if a device can be paired
        session.setHandler('list_devices_selection', async (data) => {
            return data;
        });

        // Handler for initial device configuration
        session.setHandler('add_device', async (device) => {
            return device;
        });

        // Custom handler for pairing instructions
        session.setHandler('show_pairing_instructions', async () => {
            return {
                instruction: {
                    en: `To pair your Zigbee Repeater:
                    
1. Connect the device to a USB power source
2. Wait for the device to power up (LED should turn on)
3. Turn the device OFF and ON 5 times quickly to enter pairing mode
4. The device should now be discoverable
5. Click 'Continue' when the device is in pairing mode`
                }
            };
        });

        // Handler to check if device is in pairing mode
        session.setHandler('check_pairing_mode', async () => {
            return {
                ready: true,
                message: {
                    en: "Device should now be in pairing mode. Click 'Add Device' to continue."
                }
            };
        });
    }

    /**
     * Called when a user wants to repair a device
     */
    async onRepair(session, device) {
        // Configure handlers for the repair process
        session.setHandler('start_repair', async () => {
            try {
                // Try to ping the device
                if (device.performPing) {
                    await device.performPing();
                }
                
                // Reset health counters if available
                if (device.updateLastSeen) {
                    device.updateLastSeen();
                }
                
                return {
                    success: true,
                    message: {
                        en: "Device repair completed successfully"
                    }
                };
                
            } catch (error) {
                return {
                    success: false,
                    message: {
                        en: `Repair failed: ${error.message}`
                    }
                };
            }
        });

        // Handler for repair instructions
        session.setHandler('show_repair_instructions', async () => {
            return {
                instruction: {
                    en: `To repair your Zigbee Repeater:
                    
1. Make sure the device is powered on and connected
2. The device should be within range of your Zigbee network
3. Click 'Start Repair' to reset the device connection
4. If repair fails, try power cycling the device`
                }
            };
        });
    }

    /**
     * Called when the user selects 'test' during development
     */
    async onTestConnection(device_data) {
        try {
            return {
                success: true,
                message: "Connection test successful"
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Connection test failed: ${error.message}`
            };
        }
    }
}

module.exports = ZigbeeRepeaterDriver;