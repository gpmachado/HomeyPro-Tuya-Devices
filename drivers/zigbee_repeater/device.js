/**
 * device.js - Zigbee Repeater Device
 * Version: 1.0.0
 * Description: Enhanced Zigbee repeater device with connectivity monitoring
 */

'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');

class ZigbeeRepeater extends ZigBeeDevice {
    
    async onNodeInit({ zclNode }) {
        this.printNode();
        
        // Configure basic monitoring
        this.lastSeen = Date.now();
        this.pingFailureCount = 0;
        this.maxPingFailures = 3;
        
        // Configure periodic ping
        this.setupPeriodicPing();
        
        // Configure basic listeners
        this.setupBasicListeners(zclNode);
        
        // Mark as available
        this.setAvailable().catch(this.error);
        
        this.log('Zigbee Repeater initialized');
    }

    setupPeriodicPing() {
        const pingIntervalMinutes = this.getSetting('ping_interval') || 30;
        
        // Clear previous interval if exists
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        
        this.pingInterval = setInterval(() => {
            this.performPing();
        }, pingIntervalMinutes * 60 * 1000);
        
        // First ping after 30 seconds
        setTimeout(() => {
            this.performPing();
        }, 30000);
    }

    setupBasicListeners(zclNode) {
        if (!zclNode || !zclNode.endpoints || !zclNode.endpoints[1]) {
            return;
        }

        const endpoint = zclNode.endpoints[1];
        
        // Listener for basic cluster
        if (endpoint.clusters && endpoint.clusters.basic) {
            // Any attribute from basic cluster indicates activity
            endpoint.clusters.basic.on('attr', () => {
                this.updateLastSeen();
            });
        }
        
        // Listener for identify cluster
        if (endpoint.clusters && endpoint.clusters.identify) {
            endpoint.clusters.identify.on('attr', () => {
                this.updateLastSeen();
            });
        }

        // Listener for time cluster
        if (endpoint.clusters && endpoint.clusters.time) {
            endpoint.clusters.time.on('attr', () => {
                this.updateLastSeen();
            });
        }
    }

    async performPing() {
        try {
            const pingType = this.getSetting('ping_type') || 'basic_read';
            
            if (pingType === 'basic_read') {
                await this.pingBasicRead();
            } else if (pingType === 'manufacturer_read') {
                await this.pingManufacturerRead();
            } else {
                await this.pingBasicRead(); // fallback
            }
            
            // Ping successful
            this.pingFailureCount = 0;
            this.updateLastSeen();
            this.setAvailable().catch(this.error);
            
        } catch (error) {
            this.pingFailureCount++;
            
            if (this.pingFailureCount >= this.maxPingFailures) {
                this.setUnavailable('Device not responding').catch(this.error);
            }
        }
    }

    async pingBasicRead() {
        if (!this.zclNode || !this.zclNode.endpoints[1] || !this.zclNode.endpoints[1].clusters.basic) {
            throw new Error('Basic cluster not available');
        }
        
        return await this.zclNode.endpoints[1].clusters.basic.readAttributes(['zclVersion']);
    }

    async pingManufacturerRead() {
        if (!this.zclNode || !this.zclNode.endpoints[1] || !this.zclNode.endpoints[1].clusters.basic) {
            throw new Error('Basic cluster not available');
        }
        
        return await this.zclNode.endpoints[1].clusters.basic.readAttributes(['manufacturerName']);
    }

    updateLastSeen() {
        this.lastSeen = Date.now();
        this.pingFailureCount = 0;
        
        // If was unavailable, mark as available
        if (!this.getAvailable()) {
            this.setAvailable().catch(this.error);
        }
    }

    onDeleted() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        // Reconfigure ping if interval changed
        if (changedKeys.includes('ping_interval')) {
            this.setupPeriodicPing();
        }
        
        // Quick test if ping type changed
        if (changedKeys.includes('ping_type')) {
            setTimeout(() => this.performPing(), 2000);
        }
    }
}

module.exports = ZigbeeRepeater;