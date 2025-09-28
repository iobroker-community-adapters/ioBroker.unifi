# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context
- **Adapter Name**: iobroker.unifi
- **Primary Function**: UniFi Network monitoring and control adapter that connects to Ubiquiti UniFi Controllers to manage WiFi Access Points, clients, and network infrastructure
- **Key Dependencies**: node-unifi (v2.5.1), axios for HTTP requests, UniFi Controller Web API
- **Configuration Requirements**: UniFi Controller IP/port, local credentials (no 2FA support), update intervals
- **Target Devices**: UniFi WiFi Access Points, UniFi Network Controllers (UDM-Pro, CloudKey), UniFi switches and gateways
- **Core Features**: Client monitoring, device status tracking, WiFi enable/disable, voucher creation, health monitoring, network traffic analysis

### UniFi-Specific Development Context
This adapter connects to Ubiquiti UniFi Controllers to provide comprehensive network monitoring and limited control capabilities. Key aspects include:

- **Network Infrastructure Focus**: Manages enterprise-grade WiFi networks with multiple access points
- **External API Dependency**: Relies on UniFi Controller Web API - requires active controller connection
- **Real-time Monitoring**: Tracks client connections, device health, network performance metrics
- **Limited Control Operations**: Can enable/disable SSIDs, create vouchers, restart devices, control LED overrides
- **Multi-site Support**: Can manage multiple UniFi sites from a single controller
- **Data Filtering**: Supports extensive filtering for clients, devices, networks to optimize performance

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Verify expected states exist and have reasonable values
                        const states = await harness.states.getStatesAsync('your-adapter.0.*');
                        
                        expect(states).to.be.an('object');
                        expect(Object.keys(states)).to.have.length.greaterThan(0);
                        
                        resolve();
                    } catch (error) {
                        console.error('Test failed:', error);
                        reject(error);
                    }
                }).timeout(45000);
            });
        });
    }
});
```

### UniFi Adapter Testing Strategy

For the UniFi adapter specifically, implement comprehensive testing that handles external dependencies:

#### Mock Testing for Core Logic
```javascript
// Test core UniFi data processing without live connections
describe('UniFi Data Processing', () => {
    test('should parse client data correctly', () => {
        const mockClientData = {
            mac: '00:11:22:33:44:55',
            hostname: 'test-device',
            ip: '192.168.1.100',
            is_online: true
        };
        
        const result = processClientData(mockClientData);
        expect(result.connection).toBe(true);
        expect(result.device_name).toBe('test-device');
    });
    
    test('should handle UniFi API errors gracefully', () => {
        const mockError = { code: 401, message: 'Unauthorized' };
        const result = handleUnifiError(mockError);
        expect(result.reconnect).toBe(true);
        expect(result.delay).toBeGreaterThan(5000);
    });
});
```

#### Integration Tests with Mock UniFi Controller
```javascript
// Integration test with simulated UniFi responses
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('UniFi Controller Integration', (getHarness) => {
            it('should handle controller connection and data retrieval', async function() {
                const harness = getHarness();
                
                await harness.changeAdapterConfig('unifi', {
                    native: {
                        controllerIp: '192.168.1.1',
                        controllerPort: '8443',
                        controllerUsername: 'test',
                        controllerPassword: 'encrypted_password',
                        updateInterval: 30,
                        updateClients: true,
                        updateDevices: true
                    }
                });
                
                await harness.startAdapter();
                await wait(10000); // Wait for initial connection attempt
                
                // Check connection state
                const connectionState = await harness.states.getStateAsync('unifi.0.info.connection');
                
                // In test environment, connection may fail but adapter should handle gracefully
                expect(connectionState).to.be.ok;
                expect(typeof connectionState.val).toBe('boolean');
            }).timeout(30000);
        });
    }
});
```

## Error Handling

### UniFi API Error Handling

The UniFi adapter must handle various API connection scenarios:

```javascript
// Connection error handling
async connectToController() {
    try {
        await this.unifi.login(this.config.username, this.config.password);
        this.setState('info.connection', true, true);
        this.log.info('Connected to UniFi Controller');
    } catch (error) {
        this.setState('info.connection', false, true);
        
        if (error.code === 'ECONNREFUSED') {
            this.log.error('Cannot connect to UniFi Controller - check IP and port');
        } else if (error.code === 401) {
            this.log.error('Authentication failed - check username and password');
        } else if (error.code === 'CERT_UNTRUSTED') {
            this.log.warn('SSL certificate issue - consider enabling ignoreSSLErrors');
        } else {
            this.log.error(`UniFi connection error: ${error.message}`);
        }
        
        // Implement exponential backoff for reconnection
        this.scheduleReconnect();
    }
}

// API rate limiting and retry logic
async makeUnifiRequest(endpoint, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await this.unifi.get(endpoint);
            return result;
        } catch (error) {
            if (i === retries - 1) throw error;
            
            const delay = Math.pow(2, i) * 1000; // Exponential backoff
            this.log.debug(`Request failed, retrying in ${delay}ms...`);
            await this.delay(delay);
        }
    }
}
```

### State Management and Data Processing

```javascript
// Robust state updates with error handling
async updateClientStates(clients) {
    for (const client of clients) {
        try {
            const clientId = this.cleanNamespace(client.hostname || client.mac);
            const basePath = `clients.${clientId}`;
            
            // Validate data before setting states
            if (client.mac && this.isValidMacAddress(client.mac)) {
                await this.setStateAsync(`${basePath}.mac`, client.mac, true);
            }
            
            if (client.ip && this.isValidIpAddress(client.ip)) {
                await this.setStateAsync(`${basePath}.ip`, client.ip, true);
            }
            
            // Handle boolean states with proper validation
            await this.setStateAsync(`${basePath}.is_online`, Boolean(client.is_online), true);
            
        } catch (error) {
            this.log.warn(`Failed to update client ${client.mac}: ${error.message}`);
            // Continue processing other clients instead of failing completely
        }
    }
}

// Network reconnection with intelligent retry
scheduleReconnect() {
    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
    }
    
    // Implement exponential backoff with maximum delay
    const delay = Math.min(this.reconnectAttempts * 5000, 60000);
    this.reconnectAttempts++;
    
    this.log.info(`Scheduling reconnect in ${delay/1000} seconds (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
        this.connectToController();
    }, delay);
}
```

## Performance and Resource Management

### Memory Management for Large Networks
```javascript
// Efficient data processing for large UniFi deployments
async processLargeDataSet(data, batchSize = 50) {
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        await this.processBatch(batch);
        
        // Allow event loop to process other tasks
        await this.delay(10);
    }
}

// Clean up resources in unload
async unload(callback) {
    try {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.unifi) {
            await this.unifi.logout();
            this.unifi = null;
        }
        
        this.log.info('UniFi adapter stopped');
        callback();
    } catch (error) {
        this.log.error(`Error during unload: ${error.message}`);
        callback();
    }
}
```

## JSON Configuration

When working with the UniFi adapter's admin interface configuration:

### JSON-Config Structure
```json
{
    "type": "panel",
    "items": {
        "connectionSettings": {
            "type": "panel",
            "label": "Connection Settings",
            "items": {
                "controllerIp": {
                    "type": "ip",
                    "label": "UniFi Controller IP",
                    "tooltip": "IP address of your UniFi Controller"
                },
                "controllerPort": {
                    "type": "number",
                    "label": "Controller Port",
                    "min": 1,
                    "max": 65535,
                    "default": 8443
                },
                "ignoreSSLErrors": {
                    "type": "checkbox",
                    "label": "Ignore SSL Certificate Errors",
                    "tooltip": "Enable for self-signed certificates"
                }
            }
        },
        "updateSettings": {
            "type": "panel",
            "label": "Update Settings",
            "items": {
                "updateInterval": {
                    "type": "number",
                    "label": "Update Interval (seconds)",
                    "min": 10,
                    "default": 60
                },
                "updateClients": {
                    "type": "checkbox",
                    "label": "Update Client Information",
                    "default": true
                }
            }
        }
    }
}
```

### Configuration Validation
```javascript
// Validate configuration on adapter start
validateConfig() {
    const errors = [];
    
    if (!this.config.controllerIp) {
        errors.push('UniFi Controller IP address is required');
    }
    
    if (this.config.updateInterval < 10) {
        errors.push('Update interval must be at least 10 seconds');
    }
    
    if (!this.config.controllerUsername || !this.config.controllerPassword) {
        errors.push('Controller credentials are required');
    }
    
    if (errors.length > 0) {
        this.log.error('Configuration validation failed:');
        errors.forEach(error => this.log.error(`  - ${error}`));
        return false;
    }
    
    return true;
}
```

## Logging and Debugging

### Comprehensive Logging Strategy
```javascript
// Use appropriate log levels for different scenarios
this.log.error('Connection to UniFi Controller failed'); // Critical errors only
this.log.warn('SSL certificate validation disabled'); // Warnings for security/config issues
this.log.info('Connected to UniFi Controller at 192.168.1.1:8443'); // Important operational info
this.log.debug('Processing 47 clients and 12 devices'); // Verbose operational details

// Structured logging for troubleshooting
this.log.debug(`API Response: ${JSON.stringify(response, null, 2)}`);
this.log.info(`UniFi Site: ${siteName} | Clients: ${clientCount} | Devices: ${deviceCount}`);

// Log performance metrics
const startTime = Date.now();
await this.processData();
const duration = Date.now() - startTime;
this.log.debug(`Data processing completed in ${duration}ms`);
```

## UniFi Network Adapter Best Practices

### Controller Connection Management
- Always validate controller connectivity before making API calls
- Implement proper session management and re-authentication
- Handle controller reboots and firmware updates gracefully
- Support both regular controllers and UnifiOS (UDM-Pro) environments

### Data Synchronization
- Respect API rate limits to avoid overwhelming the controller
- Use appropriate update intervals based on network size
- Implement data filtering to reduce unnecessary processing
- Handle partial data updates when some endpoints fail

### Network State Management
- Monitor connection quality and signal strength trends
- Track device health and performance metrics
- Provide actionable alerts for network issues
- Support multi-site deployments with proper site isolation

### Security Considerations
- Never log credentials or sensitive network information
- Validate SSL certificates unless explicitly disabled
- Implement proper password encryption for storage
- Respect UniFi's security model and permissions

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```