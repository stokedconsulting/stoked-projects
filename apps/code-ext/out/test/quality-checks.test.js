"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const quality_checks_1 = require("../quality-checks");
suite('Quality Checks Test Suite', () => {
    let tempDir;
    // Helper to create a temporary workspace
    function createTempWorkspace() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-test-'));
        return dir;
    }
    // Helper to cleanup temp directory
    function cleanupTempWorkspace(dir) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    suiteSetup(() => {
        tempDir = createTempWorkspace();
    });
    suiteTeardown(() => {
        cleanupTempWorkspace(tempDir);
    });
    suite('Test Execution', () => {
        test('AC-3.4.a: Tests run successfully and capture exit code (passing)', async () => {
            const testDir = createTempWorkspace();
            // Create package.json with passing test
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const startTime = Date.now();
            const result = await (0, quality_checks_1.runTests)(testDir);
            const duration = Date.now() - startTime;
            assert.strictEqual(result.passed, true, 'Tests should pass');
            assert.strictEqual(result.exitCode, 0, 'Exit code should be 0');
            assert.ok(result.duration > 0, 'Duration should be recorded');
            assert.ok(result.duration <= 5000, 'Should complete quickly for simple test');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.a: Tests run and capture exit code (failing)', async () => {
            const testDir = createTempWorkspace();
            // Create package.json with failing test
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 1'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runTests)(testDir);
            assert.strictEqual(result.passed, false, 'Tests should fail');
            assert.strictEqual(result.exitCode, 1, 'Exit code should be 1');
            assert.ok(result.output.length > 0, 'Output should be captured');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.a: Tests respect timeout limit', async () => {
            const testDir = createTempWorkspace();
            // Create package.json with long-running test
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'sleep 10'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const startTime = Date.now();
            const result = await (0, quality_checks_1.runTests)(testDir, 2000); // 2 second timeout
            const duration = Date.now() - startTime;
            assert.strictEqual(result.passed, false, 'Tests should fail due to timeout');
            assert.strictEqual(result.exitCode, 124, 'Exit code should be 124 (timeout)');
            assert.ok(duration < 5000, 'Should timeout within reasonable time');
            assert.ok(result.output.includes('timeout'), 'Output should mention timeout');
            cleanupTempWorkspace(testDir);
        }).timeout(10000);
        test('AC-3.4.a: Missing package.json handled gracefully', async () => {
            const testDir = createTempWorkspace();
            const result = await (0, quality_checks_1.runTests)(testDir);
            assert.strictEqual(result.passed, true, 'Should pass when no package.json');
            assert.strictEqual(result.exitCode, 0, 'Exit code should be 0');
            assert.ok(result.output.includes('No package.json'), 'Output should mention missing package.json');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.a: Missing test script handled gracefully', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {}
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runTests)(testDir);
            assert.strictEqual(result.passed, true, 'Should pass when no test script');
            assert.strictEqual(result.exitCode, 0, 'Exit code should be 0');
            assert.ok(result.output.includes('No test script'), 'Output should mention missing test script');
            cleanupTempWorkspace(testDir);
        });
    });
    suite('Linting', () => {
        test('AC-3.4.b: Linting runs and captures error count', async () => {
            const testDir = createTempWorkspace();
            // Create package.json with lint script that reports errors
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    lint: 'echo "file.ts:10:5: error Missing semicolon" && echo "file.ts:20:1: error Unused variable" && exit 1'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runLinting)(testDir);
            assert.strictEqual(result.passed, false, 'Linting should fail');
            assert.ok(result.errorCount >= 2, 'Should capture at least 2 errors');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.b: Linting captures error details', async () => {
            const testDir = createTempWorkspace();
            // Create package.json with lint script
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    lint: 'echo "src/file.ts:42:10: error Unexpected token" && exit 1'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runLinting)(testDir);
            assert.strictEqual(result.passed, false, 'Linting should fail');
            assert.ok(result.errors.length > 0, 'Should capture error details');
            if (result.errors.length > 0) {
                assert.ok(result.errors[0].file.includes('file.ts'), 'Should capture file name');
                assert.strictEqual(result.errors[0].line, 42, 'Should capture line number');
                assert.ok(result.errors[0].message.includes('Unexpected token'), 'Should capture error message');
            }
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.b: Passing linting returns zero errors', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    lint: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runLinting)(testDir);
            assert.strictEqual(result.passed, true, 'Linting should pass');
            assert.strictEqual(result.errorCount, 0, 'Should have zero errors');
            assert.strictEqual(result.errors.length, 0, 'Should have empty error array');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.b: Missing lint script handled gracefully', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {}
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runLinting)(testDir);
            assert.strictEqual(result.passed, true, 'Should pass when no lint script');
            assert.strictEqual(result.errorCount, 0, 'Should have zero errors');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.b: Warnings are counted separately from errors', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    lint: 'echo "file.ts:10:5: warning Prefer const over let" && exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runLinting)(testDir);
            assert.strictEqual(result.passed, true, 'Should pass with only warnings');
            assert.strictEqual(result.errorCount, 0, 'Should have zero errors');
            assert.ok(result.warningCount >= 1, 'Should capture warning count');
            cleanupTempWorkspace(testDir);
        });
    });
    suite('Security Scanning', () => {
        test('AC-3.4.c: Security scan categorizes vulnerabilities by severity', async () => {
            const testDir = createTempWorkspace();
            // Create package.json
            const packageJson = {
                name: 'test-project',
                version: '1.0.0'
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runSecurityScan)(testDir);
            assert.ok(result.vulnerabilities !== undefined, 'Should have vulnerabilities object');
            assert.ok(typeof result.vulnerabilities.critical === 'number', 'Critical count should be a number');
            assert.ok(typeof result.vulnerabilities.high === 'number', 'High count should be a number');
            assert.ok(typeof result.vulnerabilities.moderate === 'number', 'Moderate count should be a number');
            assert.ok(typeof result.vulnerabilities.low === 'number', 'Low count should be a number');
            cleanupTempWorkspace(testDir);
        }).timeout(70000);
        test('AC-3.4.c: No vulnerabilities passes security check', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                dependencies: {}
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runSecurityScan)(testDir);
            // With no dependencies, should have no vulnerabilities
            assert.strictEqual(result.vulnerabilities.critical, 0, 'Should have no critical vulnerabilities');
            assert.strictEqual(result.vulnerabilities.high, 0, 'Should have no high vulnerabilities');
            cleanupTempWorkspace(testDir);
        }).timeout(70000);
        test('AC-3.4.c: Missing package.json handled gracefully', async () => {
            const testDir = createTempWorkspace();
            const result = await (0, quality_checks_1.runSecurityScan)(testDir);
            assert.strictEqual(result.passed, true, 'Should pass when no package.json');
            assert.strictEqual(result.vulnerabilities.critical, 0, 'Should have no vulnerabilities');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.e: Critical or high vulnerabilities fail security check', () => {
            const resultWithCritical = {
                passed: false,
                vulnerabilities: {
                    critical: 1,
                    high: 0,
                    moderate: 0,
                    low: 0
                }
            };
            const resultWithHigh = {
                passed: false,
                vulnerabilities: {
                    critical: 0,
                    high: 2,
                    moderate: 0,
                    low: 0
                }
            };
            const resultWithModerate = {
                passed: true,
                vulnerabilities: {
                    critical: 0,
                    high: 0,
                    moderate: 5,
                    low: 10
                }
            };
            assert.strictEqual(resultWithCritical.passed, false, 'Critical vulnerabilities should fail');
            assert.strictEqual(resultWithHigh.passed, false, 'High vulnerabilities should fail');
            assert.strictEqual(resultWithModerate.passed, true, 'Moderate/low only should pass');
        });
    });
    suite('Documentation Coverage', () => {
        test('AC-3.4.d: Documentation coverage percentage is calculated', async () => {
            const testDir = createTempWorkspace();
            // Create a file with some documented and undocumented items
            const code = `
/**
 * This function is documented
 */
export function documentedFunction() {}

export function undocumentedFunction() {}

/**
 * This class is documented
 */
export class DocumentedClass {}

export class UndocumentedClass {}
`;
            const filePath = path.join(testDir, 'test.ts');
            fs.writeFileSync(filePath, code);
            const result = await (0, quality_checks_1.checkDocumentation)([filePath]);
            assert.ok(typeof result.coveragePercent === 'number', 'Coverage should be a number');
            assert.ok(result.coveragePercent >= 0 && result.coveragePercent <= 100, 'Coverage should be 0-100');
            assert.strictEqual(result.coveragePercent, 50, 'Should be 50% coverage (2/4 documented)');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.d: Undocumented items are listed', async () => {
            const testDir = createTempWorkspace();
            const code = `
export function undocumentedFunction() {}

export const UNDOCUMENTED_CONST = 42;
`;
            const filePath = path.join(testDir, 'test.ts');
            fs.writeFileSync(filePath, code);
            const result = await (0, quality_checks_1.checkDocumentation)([filePath]);
            assert.ok(result.undocumented.length > 0, 'Should list undocumented items');
            assert.ok(result.undocumented.some(item => item.includes('undocumentedFunction')), 'Should include undocumented function');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.d: Test files are excluded from documentation check', async () => {
            const testDir = createTempWorkspace();
            const code = `
export function testFunction() {}
`;
            const testFilePath = path.join(testDir, 'test.test.ts');
            fs.writeFileSync(testFilePath, code);
            const result = await (0, quality_checks_1.checkDocumentation)([testFilePath]);
            // Test files should be filtered out, resulting in 100% coverage
            assert.strictEqual(result.coveragePercent, 100, 'Test files should be excluded');
            assert.strictEqual(result.undocumented.length, 0, 'No undocumented items');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.f: Documentation below 50% fails but is non-blocking', async () => {
            const testDir = createTempWorkspace();
            const code = `
export function func1() {}
export function func2() {}
export function func3() {}
/**
 * Documented
 */
export function func4() {}
`;
            const filePath = path.join(testDir, 'test.ts');
            fs.writeFileSync(filePath, code);
            const result = await (0, quality_checks_1.checkDocumentation)([filePath]);
            assert.strictEqual(result.coveragePercent, 25, 'Should be 25% coverage (1/4)');
            assert.strictEqual(result.passed, false, 'Should fail with < 50% coverage');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.f: Documentation above 50% passes', async () => {
            const testDir = createTempWorkspace();
            const code = `
/**
 * Documented
 */
export function func1() {}
/**
 * Documented
 */
export function func2() {}
export function func3() {}
`;
            const filePath = path.join(testDir, 'test.ts');
            fs.writeFileSync(filePath, code);
            const result = await (0, quality_checks_1.checkDocumentation)([filePath]);
            assert.ok(result.coveragePercent >= 50, 'Should be >= 50% coverage');
            assert.strictEqual(result.passed, true, 'Should pass with >= 50% coverage');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.d: Empty file list results in 100% coverage', async () => {
            const result = await (0, quality_checks_1.checkDocumentation)([]);
            assert.strictEqual(result.coveragePercent, 100, 'Empty list should be 100%');
            assert.strictEqual(result.passed, true, 'Should pass');
            cleanupTempWorkspace(tempDir);
        });
    });
    suite('Overall Quality Checks', () => {
        test('AC-3.4.e: All blocking checks passing results in overall pass', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0',
                    lint: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runAllQualityChecks)(testDir, []);
            assert.strictEqual(result.tests.passed, true, 'Tests should pass');
            assert.strictEqual(result.linting.passed, true, 'Linting should pass');
            assert.strictEqual(result.security.passed, true, 'Security should pass');
            assert.strictEqual(result.overallPass, true, 'Overall should pass');
            cleanupTempWorkspace(testDir);
        }).timeout(70000);
        test('AC-3.4.e: Failed tests cause overall failure', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 1',
                    lint: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runAllQualityChecks)(testDir, []);
            assert.strictEqual(result.tests.passed, false, 'Tests should fail');
            assert.strictEqual(result.overallPass, false, 'Overall should fail');
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), true, 'Should be blocking failure');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.e: Failed linting causes overall failure', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0',
                    lint: 'exit 1'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runAllQualityChecks)(testDir, []);
            assert.strictEqual(result.linting.passed, false, 'Linting should fail');
            assert.strictEqual(result.overallPass, false, 'Overall should fail');
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), true, 'Should be blocking failure');
            cleanupTempWorkspace(testDir);
        });
        test('AC-3.4.f: Failed documentation does not cause overall failure', async () => {
            const testDir = createTempWorkspace();
            // Create passing tests and linting
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0',
                    lint: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            // Create undocumented code
            const code = `
export function func1() {}
export function func2() {}
`;
            const filePath = path.join(testDir, 'test.ts');
            fs.writeFileSync(filePath, code);
            const result = await (0, quality_checks_1.runAllQualityChecks)(testDir, [filePath]);
            assert.strictEqual(result.documentation.passed, false, 'Documentation should fail');
            assert.strictEqual(result.overallPass, true, 'Overall should still pass');
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), false, 'Should not be blocking failure');
            cleanupTempWorkspace(testDir);
        }).timeout(70000);
        test('isBlockingFailure returns true for test failures', () => {
            const result = {
                tests: { passed: false, exitCode: 1, output: '', duration: 1000 },
                linting: { passed: true, errorCount: 0, warningCount: 0, errors: [] },
                security: { passed: true, vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } },
                documentation: { passed: true, coveragePercent: 100, undocumented: [] },
                overallPass: false
            };
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), true, 'Failed tests should be blocking');
        });
        test('isBlockingFailure returns true for linting failures', () => {
            const result = {
                tests: { passed: true, exitCode: 0, output: '', duration: 1000 },
                linting: { passed: false, errorCount: 5, warningCount: 0, errors: [] },
                security: { passed: true, vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } },
                documentation: { passed: true, coveragePercent: 100, undocumented: [] },
                overallPass: false
            };
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), true, 'Failed linting should be blocking');
        });
        test('isBlockingFailure returns true for security failures', () => {
            const result = {
                tests: { passed: true, exitCode: 0, output: '', duration: 1000 },
                linting: { passed: true, errorCount: 0, warningCount: 0, errors: [] },
                security: { passed: false, vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0 } },
                documentation: { passed: true, coveragePercent: 100, undocumented: [] },
                overallPass: false
            };
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), true, 'Failed security should be blocking');
        });
        test('isBlockingFailure returns false for documentation-only failures', () => {
            const result = {
                tests: { passed: true, exitCode: 0, output: '', duration: 1000 },
                linting: { passed: true, errorCount: 0, warningCount: 0, errors: [] },
                security: { passed: true, vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } },
                documentation: { passed: false, coveragePercent: 30, undocumented: ['file.ts'] },
                overallPass: true
            };
            assert.strictEqual((0, quality_checks_1.isBlockingFailure)(result), false, 'Failed documentation should not be blocking');
        });
    });
    suite('Package Manager Detection', () => {
        test('Detects pnpm when pnpm-lock.yaml exists', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            fs.writeFileSync(path.join(testDir, 'pnpm-lock.yaml'), '');
            const result = await (0, quality_checks_1.runTests)(testDir);
            // Should successfully run with pnpm
            assert.strictEqual(result.passed, true, 'Should run with pnpm');
            cleanupTempWorkspace(testDir);
        });
        test('Defaults to npm when no lock file exists', async () => {
            const testDir = createTempWorkspace();
            const packageJson = {
                name: 'test-project',
                version: '1.0.0',
                scripts: {
                    test: 'exit 0'
                }
            };
            fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson, null, 2));
            const result = await (0, quality_checks_1.runTests)(testDir);
            // Should successfully run with npm
            assert.strictEqual(result.passed, true, 'Should run with npm');
            cleanupTempWorkspace(testDir);
        });
    });
});
//# sourceMappingURL=quality-checks.test.js.map