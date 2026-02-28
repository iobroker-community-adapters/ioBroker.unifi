# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.5.7  
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

---

## 📑 Table of Contents

1. [Project Context](#project-context)
2. [Code Quality & Standards](#code-quality--standards)
   - [Code Style Guidelines](#code-style-guidelines)
   - [ESLint Configuration](#eslint-configuration)
3. [Testing](#testing)
   - [Unit Testing](#unit-testing)
   - [Integration Testing](#integration-testing)
   - [API Testing with Credentials](#api-testing-with-credentials)
4. [Development Best Practices](#development-best-practices)
   - [Dependency Management](#dependency-management)
   - [HTTP Client Libraries](#http-client-libraries)
   - [Error Handling](#error-handling)
5. [Admin UI Configuration](#admin-ui-configuration)
   - [JSON-Config Setup](#json-config-setup)
   - [Translation Management](#translation-management)
6. [Documentation](#documentation)
   - [README Updates](#readme-updates)
   - [Changelog Management](#changelog-management)
7. [CI/CD & GitHub Actions](#cicd--github-actions)
   - [Workflow Configuration](#workflow-configuration)
   - [Testing Integration](#testing-integration)

---

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

---

## Code Quality & Standards

### Code Style Guidelines

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

**Timer and Resource Cleanup Example:**
```javascript
private connectionTimer?: NodeJS.Timeout;

async onReady() {
  this.connectionTimer = setInterval(() => this.checkConnection(), 30000);
}

onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    callback();
  } catch (e) {
    callback();
  }
}
```

### ESLint Configuration

**CRITICAL:** ESLint validation must run FIRST in your CI/CD pipeline, before any other tests. This "lint-first" approach catches code quality issues early.

#### Setup
```bash
npm install --save-dev eslint @iobroker/eslint-config
```

#### Configuration (.eslintrc.json)
```json
{
  "extends": "@iobroker/eslint-config",
  "rules": {
    // Add project-specific rule overrides here if needed
  }
}
```

#### Package.json Scripts
```json
{
  "scripts": {
    "lint": "eslint --max-warnings 0 .",
    "lint:fix": "eslint . --fix"
  }
}
```

#### Best Practices
1. ✅ Run ESLint before committing — fix ALL warnings, not just errors
2. ✅ Use `lint:fix` for auto-fixable issues
3. ✅ Don't disable rules without documentation
4. ✅ Lint all relevant files (main code, tests, build scripts)
5. ✅ Keep `@iobroker/eslint-config` up to date
6. ✅ **ESLint warnings are treated as errors in CI** (`--max-warnings 0`). The `lint` script above already includes this flag — run `npm run lint` to match CI behavior locally

#### Common Issues
- **Unused variables**: Remove or prefix with underscore (`_variable`)
- **Missing semicolons**: Run `npm run lint:fix`
- **Indentation**: Use 4 spaces (ioBroker standard)
- **console.log**: Replace with `adapter.log.debug()` or remove

---

## Testing

### Unit Testing

- Use Jest as the primary testing framework
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files

**Example Structure:**
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

**CRITICAL:** Use the official `@iobroker/testing` framework. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation:** https://github.com/ioBroker/testing

#### Framework Structure

**✅ Correct Pattern:**
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

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
                        // Get adapter object
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) return reject(new Error('Adapter object not found'));

                        // Configure adapter
                        Object.assign(obj.native, {
                            position: '52.520008,13.404954',
                            createHourly: true,
                        });

                        harness.objects.setObject(obj._id, obj);
                        
                        // Start and wait
                        await harness.startAdapterAndWait();
                        await new Promise(resolve => setTimeout(resolve, 15000));

                        // Verify states
                        const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
                        
                        if (stateIds.length > 0) {
                            console.log('✅ Adapter successfully created states');
                            await harness.stopAdapter();
                            resolve(true);
                        } else {
                            reject(new Error('Adapter did not create any states'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).timeout(40000);
        });
    }
});
```

#### Testing Success AND Failure Scenarios

**IMPORTANT:** For every "it works" test, implement corresponding "it fails gracefully" tests.

**Failure Scenario Example:**
```javascript
it('should NOT create daily states when daily is disabled', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));

            Object.assign(obj.native, {
                createDaily: false, // Daily disabled
            });

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            await harness.startAdapterAndWait();
            await new Promise((res) => setTimeout(res, 20000));

            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
            const dailyStates = stateIds.filter((key) => key.includes('daily'));
            
            if (dailyStates.length === 0) {
                console.log('✅ No daily states found as expected');
                resolve(true);
            } else {
                reject(new Error('Expected no daily states but found some'));
            }

            await harness.stopAdapter();
        } catch (error) {
            reject(error);
        }
    });
}).timeout(40000);
```

#### Key Rules

1. ✅ Use `@iobroker/testing` framework
2. ✅ Configure via `harness.objects.setObject()`
3. ✅ Start via `harness.startAdapterAndWait()`
4. ✅ Verify states via `harness.states.getState()`
5. ✅ Allow proper timeouts for async operations
6. ❌ NEVER test API URLs directly
7. ❌ NEVER bypass the harness system

#### Workflow Dependencies

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-22.04
```

### API Testing with Credentials

For adapters connecting to external APIs requiring authentication:

#### Password Encryption for Integration Tests

```javascript
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    if (!systemConfig?.native?.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    return result;
}
```

#### Demo Credentials Testing Pattern

- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file: `test/integration-demo.js`
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria

**Example Implementation:**
```javascript
it("Should connect to API with demo credentials", async () => {
    const encryptedPassword = await encryptPassword(harness, "demo_password");
    
    await harness.changeAdapterConfig("your-adapter", {
        native: {
            username: "demo@provider.com",
            password: encryptedPassword,
        }
    });

    await harness.startAdapter();
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
    
    if (connectionState?.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection. Check logs for API errors.");
    }
}).timeout(120000);
```

---

## Development Best Practices

### Dependency Management

- Always use `npm` for dependency management
- Use `npm ci` for installing existing dependencies (respects package-lock.json)
- Use `npm install` only when adding or updating dependencies
- Keep dependencies minimal and focused
- Only update dependencies in separate Pull Requests

**When modifying package.json:**
1. Run `npm install` to sync package-lock.json
2. Commit both package.json and package-lock.json together

**Best Practices:**
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document specific version requirements

### HTTP Client Libraries

- **Preferred:** Use native `fetch` API (Node.js 20+ required)
- **Avoid:** `axios` unless specific features are required

**Example with fetch:**
```javascript
try {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
} catch (error) {
  this.log.error(`API request failed: ${error.message}`);
}
```

**Other Recommendations:**
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises`
- **Configuration:** Use adapter config system

### Error Handling

- Always catch and log errors appropriately
- Use adapter log levels (error, warn, info, debug)
- Provide meaningful, user-friendly error messages
- Handle network failures gracefully
- Implement retry mechanisms where appropriate
- Always clean up timers, intervals, and resources in `unload()` method

**Example:**
```javascript
try {
  await this.connectToDevice();
} catch (error) {
  this.log.error(`Failed to connect to device: ${error.message}`);
  this.setState('info.connection', false, true);
  // Implement retry logic if needed
}
```

---

## Admin UI Configuration

### JSON-Config Setup

Use JSON-Config format for modern ioBroker admin interfaces.

**Example Structure:**
```json
{
  "type": "panel",
  "items": {
    "host": {
      "type": "text",
      "label": "Host address",
      "help": "IP address or hostname of the device"
    }
  }
}
```

**Guidelines:**
- ✅ Use consistent naming conventions
- ✅ Provide sensible default values
- ✅ Include validation for required fields
- ✅ Add tooltips for complex options
- ✅ Ensure translations for all supported languages (minimum English and German)
- ✅ Write end-user friendly labels, avoid technical jargon

### Translation Management

**CRITICAL:** Translation files must stay synchronized with `admin/jsonConfig.json`. Orphaned keys or missing translations cause UI issues and PR review delays.

#### Overview
- **Location:** `admin/i18n/{lang}/translations.json` for 11 languages (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn)
- **Source of truth:** `admin/jsonConfig.json` - all `label` and `help` properties must have translations
- **Command:** `npm run translate` - auto-generates translations but does NOT remove orphaned keys
- **Formatting:** English uses tabs, other languages use 4 spaces

#### Critical Rules
1. ✅ Keys must match exactly with jsonConfig.json
2. ✅ No orphaned keys in translation files
3. ✅ All translations must be in native language (no English fallbacks)
4. ✅ Keys must be sorted alphabetically

#### Workflow for Translation Updates

**When modifying admin/jsonConfig.json:**

1. Make your changes to labels/help texts
2. Run automatic translation: `npm run translate`
3. Create validation script (`scripts/validate-translations.js`):

```javascript
const fs = require('fs');
const path = require('path');
const jsonConfig = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));

function extractTexts(obj, texts = new Set()) {
    if (typeof obj === 'object' && obj !== null) {
        if (obj.label) texts.add(obj.label);
        if (obj.help) texts.add(obj.help);
        for (const key in obj) {
            extractTexts(obj[key], texts);
        }
    }
    return texts;
}

const requiredTexts = extractTexts(jsonConfig);
const languages = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
let hasErrors = false;

languages.forEach(lang => {
    const translationPath = path.join('admin', 'i18n', lang, 'translations.json');
    const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
    const translationKeys = new Set(Object.keys(translations));
    
    const missing = Array.from(requiredTexts).filter(text => !translationKeys.has(text));
    const orphaned = Array.from(translationKeys).filter(key => !requiredTexts.has(key));
    
    console.log(`\n=== ${lang} ===`);
    if (missing.length > 0) {
        console.error('❌ Missing keys:', missing);
        hasErrors = true;
    }
    if (orphaned.length > 0) {
        console.error('❌ Orphaned keys (REMOVE THESE):', orphaned);
        hasErrors = true;
    }
    if (missing.length === 0 && orphaned.length === 0) {
        console.log('✅ All keys match!');
    }
});

process.exit(hasErrors ? 1 : 0);
```

4. Run validation: `node scripts/validate-translations.js`
5. Remove orphaned keys manually from all translation files
6. Add missing translations in native languages
7. Run: `npm run lint && npm run test`

#### Add Validation to package.json

```json
{
  "scripts": {
    "translate": "translate-adapter",
    "validate:translations": "node scripts/validate-translations.js",
    "pretest": "npm run lint && npm run validate:translations"
  }
}
```

#### Translation Checklist

Before committing changes to admin UI or translations:
1. ✅ Validation script shows "All keys match!" for all 11 languages
2. ✅ No orphaned keys in any translation file
3. ✅ All translations in native language
4. ✅ Keys alphabetically sorted
5. ✅ `npm run lint` passes
6. ✅ `npm run test` passes
7. ✅ Admin UI displays correctly

---

## Documentation

### README Updates

#### Required Sections
1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history (use "## **WORK IN PROGRESS**" for ongoing changes)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, community support

#### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (minimum English and German)
- Always reference issues in commits and PRs (e.g., "fixes #xx")

#### Mandatory README Updates for PRs

For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements), **TESTING** (test additions), **CI/CD** (automation)
- Focus on user impact, not technical details

**Example:**
```markdown
## **WORK IN PROGRESS**

* (DutchmanNL) **FIXED**: Adapter now properly validates login credentials (fixes #25)
* (DutchmanNL) **NEW**: Added device discovery to simplify initial setup
```

### Changelog Management

Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard.

#### Format Requirements

```markdown
# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
-->

## **WORK IN PROGRESS**

- (author) **NEW**: Added new feature X
- (author) **FIXED**: Fixed bug Y (fixes #25)

## v0.1.0 (2023-01-01)
Initial release
```

#### Workflow Process
- **During Development:** All changes go under `## **WORK IN PROGRESS**`
- **For Every PR:** Add user-facing changes to WORK IN PROGRESS section
- **Before Merge:** Version number and date added when merging to main
- **Release Process:** Release-script automatically converts placeholder to actual version

#### Change Entry Format
- Format: `- (author) **TYPE**: User-friendly description`
- Types: **NEW**, **FIXED**, **ENHANCED**
- Focus on user impact, not technical implementation
- Reference issues: "fixes #XX" or "solves #XX"

---

## CI/CD & GitHub Actions

### Workflow Configuration

#### GitHub Actions Best Practices

**Must use ioBroker official testing actions:**
- `ioBroker/testing-action-check@v1` for lint and package validation
- `ioBroker/testing-action-adapter@v1` for adapter tests
- `ioBroker/testing-action-deploy@v1` for automated releases with Trusted Publishing (OIDC)

**Configuration:**
- **Node.js versions:** Test on 20.x, 22.x, 24.x
- **Platform:** Use ubuntu-22.04
- **Automated releases:** Deploy to npm on version tags (requires NPM Trusted Publishing)
- **Monitoring:** Include Sentry release tracking for error monitoring

#### Critical: Lint-First Validation Workflow

**ALWAYS run ESLint checks BEFORE other tests.** Benefits:
- Catches code quality issues immediately
- Prevents wasting CI resources on tests that would fail due to linting errors
- Provides faster feedback to developers
- Enforces consistent code quality

**Workflow Dependency Configuration:**
```yaml
jobs:
  check-and-lint:
    # Runs ESLint and package validation
    # Uses: ioBroker/testing-action-check@v1
    
  adapter-tests:
    needs: [check-and-lint]  # Wait for linting to pass
    # Run adapter unit tests
    
  integration-tests:
    needs: [check-and-lint, adapter-tests]  # Wait for both
    # Run integration tests
```

**Key Points:**
- The `check-and-lint` job has NO dependencies - runs first
- ALL other test jobs MUST list `check-and-lint` in their `needs` array
- If linting fails, no other tests run, saving time
- Fix all ESLint errors before proceeding

### Testing Integration

#### API Testing in CI/CD

For adapters with external API dependencies:

```yaml
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

#### Testing Best Practices
- Run credential tests separately from main test suite
- Don't make credential tests required for deployment
- Provide clear failure messages for API issues
- Use appropriate timeouts for external calls (120+ seconds)

#### Package.json Integration
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

---

## UniFi Adapter Testing Strategy

For the UniFi adapter specifically, implement comprehensive testing that handles external dependencies:

### Mock Testing for Core Logic
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

### Integration Tests with Mock UniFi Controller
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

## UniFi API Error Handling

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

## State Management and Data Processing

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
