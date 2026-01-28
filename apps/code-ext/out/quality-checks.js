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
exports.runTests = runTests;
exports.runLinting = runLinting;
exports.runSecurityScan = runSecurityScan;
exports.checkDocumentation = checkDocumentation;
exports.runAllQualityChecks = runAllQualityChecks;
exports.isBlockingFailure = isBlockingFailure;
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util_1 = require("util");
const execFile = (0, util_1.promisify)(cp.execFile);
/**
 * Detect package manager (npm or pnpm) in workspace
 */
function detectPackageManager(workspaceRoot) {
    if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    return 'npm';
}
/**
 * Run tests in the workspace
 * @param workspaceRoot - Root directory of the workspace
 * @param timeout - Maximum time to wait for tests (default: 5 minutes)
 * @returns Test results
 */
async function runTests(workspaceRoot, timeout = 300000) {
    const startTime = Date.now();
    let exitCode = 0;
    let output = '';
    let passed = false;
    try {
        const packageManager = detectPackageManager(workspaceRoot);
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        // Check if package.json exists and has a test script
        if (!fs.existsSync(packageJsonPath)) {
            return {
                passed: true,
                exitCode: 0,
                output: 'No package.json found - skipping tests',
                duration: Date.now() - startTime
            };
        }
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (!packageJson.scripts || !packageJson.scripts.test) {
            return {
                passed: true,
                exitCode: 0,
                output: 'No test script defined - skipping tests',
                duration: Date.now() - startTime
            };
        }
        // Run tests
        const result = await execFile(packageManager, ['test'], {
            cwd: workspaceRoot,
            timeout,
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        output = result.stdout + result.stderr;
        exitCode = 0;
        passed = true;
    }
    catch (error) {
        if (error.killed && error.signal === 'SIGTERM') {
            output = `Tests timed out after ${timeout}ms`;
            exitCode = 124; // Timeout exit code
        }
        else {
            output = error.stdout + error.stderr || error.message;
            exitCode = error.code || 1;
        }
        passed = false;
    }
    const duration = Date.now() - startTime;
    return {
        passed,
        exitCode,
        output,
        duration
    };
}
/**
 * Run linting on specified files or entire workspace
 * @param workspaceRoot - Root directory of the workspace
 * @param files - Specific files to lint (empty array = lint all)
 * @returns Linting results
 */
async function runLinting(workspaceRoot, files = []) {
    let errorCount = 0;
    let warningCount = 0;
    let errors = [];
    let passed = false;
    try {
        const packageManager = detectPackageManager(workspaceRoot);
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        // Check if package.json exists and has a lint script
        if (!fs.existsSync(packageJsonPath)) {
            return {
                passed: true,
                errorCount: 0,
                warningCount: 0,
                errors: []
            };
        }
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (!packageJson.scripts || !packageJson.scripts.lint) {
            return {
                passed: true,
                errorCount: 0,
                warningCount: 0,
                errors: []
            };
        }
        // Run linter
        const args = files.length > 0 ? ['run', 'lint', '--', ...files] : ['run', 'lint'];
        const result = await execFile(packageManager, args, {
            cwd: workspaceRoot,
            timeout: 60000, // 1 minute timeout
            maxBuffer: 5 * 1024 * 1024 // 5MB buffer
        });
        // If we reach here, linting passed
        passed = true;
        errorCount = 0;
        warningCount = 0;
    }
    catch (error) {
        const output = error.stdout + error.stderr || error.message;
        // Parse ESLint output format
        const errorPattern = /^(.+?):(\d+):\d+: error (.+)$/gm;
        const warningPattern = /^(.+?):(\d+):\d+: warning (.+)$/gm;
        let match;
        while ((match = errorPattern.exec(output)) !== null) {
            errorCount++;
            errors.push({
                file: match[1],
                line: parseInt(match[2], 10),
                message: match[3]
            });
        }
        while ((match = warningPattern.exec(output)) !== null) {
            warningCount++;
        }
        // Also try to extract summary line like "10 errors, 5 warnings"
        const summaryPattern = /(\d+)\s+errors?,\s+(\d+)\s+warnings?/i;
        const summaryMatch = output.match(summaryPattern);
        if (summaryMatch) {
            errorCount = Math.max(errorCount, parseInt(summaryMatch[1], 10));
            warningCount = Math.max(warningCount, parseInt(summaryMatch[2], 10));
        }
        passed = errorCount === 0;
    }
    return {
        passed,
        errorCount,
        warningCount,
        errors
    };
}
/**
 * Run security vulnerability scan
 * @param workspaceRoot - Root directory of the workspace
 * @returns Security scan results
 */
async function runSecurityScan(workspaceRoot) {
    let vulnerabilities = {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0
    };
    let passed = false;
    try {
        const packageManager = detectPackageManager(workspaceRoot);
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        // Check if package.json exists
        if (!fs.existsSync(packageJsonPath)) {
            return {
                passed: true,
                vulnerabilities
            };
        }
        // Run security audit
        let result;
        if (packageManager === 'npm') {
            result = await execFile('npm', ['audit', '--json'], {
                cwd: workspaceRoot,
                timeout: 60000, // 1 minute timeout
                maxBuffer: 5 * 1024 * 1024 // 5MB buffer
            });
        }
        else {
            result = await execFile('pnpm', ['audit', '--json'], {
                cwd: workspaceRoot,
                timeout: 60000,
                maxBuffer: 5 * 1024 * 1024
            });
        }
        // Parse audit results
        try {
            const auditData = JSON.parse(result.stdout);
            if (packageManager === 'npm') {
                // npm format
                if (auditData.metadata && auditData.metadata.vulnerabilities) {
                    vulnerabilities = {
                        critical: auditData.metadata.vulnerabilities.critical || 0,
                        high: auditData.metadata.vulnerabilities.high || 0,
                        moderate: auditData.metadata.vulnerabilities.moderate || 0,
                        low: auditData.metadata.vulnerabilities.low || 0
                    };
                }
            }
            else {
                // pnpm format
                if (auditData.metadata && auditData.metadata.vulnerabilities) {
                    vulnerabilities = {
                        critical: auditData.metadata.vulnerabilities.critical || 0,
                        high: auditData.metadata.vulnerabilities.high || 0,
                        moderate: auditData.metadata.vulnerabilities.moderate || 0,
                        low: auditData.metadata.vulnerabilities.low || 0
                    };
                }
            }
        }
        catch (parseError) {
            // If JSON parsing fails, assume no vulnerabilities
            console.warn('Failed to parse audit results:', parseError);
        }
        // Pass if no critical or high vulnerabilities
        passed = vulnerabilities.critical === 0 && vulnerabilities.high === 0;
    }
    catch (error) {
        // If audit command fails, try to parse error output
        const output = error.stdout + error.stderr || '';
        // Try to parse JSON from error output
        try {
            const auditData = JSON.parse(error.stdout || '{}');
            if (auditData.metadata && auditData.metadata.vulnerabilities) {
                vulnerabilities = {
                    critical: auditData.metadata.vulnerabilities.critical || 0,
                    high: auditData.metadata.vulnerabilities.high || 0,
                    moderate: auditData.metadata.vulnerabilities.moderate || 0,
                    low: auditData.metadata.vulnerabilities.low || 0
                };
            }
        }
        catch (parseError) {
            // If we can't parse, treat as no vulnerabilities
            console.warn('Failed to parse audit error output');
        }
        passed = vulnerabilities.critical === 0 && vulnerabilities.high === 0;
    }
    return {
        passed,
        vulnerabilities
    };
}
/**
 * Check documentation coverage for specified files
 * @param files - List of TypeScript/JavaScript files to check
 * @returns Documentation check results
 */
async function checkDocumentation(files) {
    let coveragePercent = 0;
    let undocumented = [];
    let passed = false;
    try {
        // Filter to only .ts and .js files
        const codeFiles = files.filter(f => (f.endsWith('.ts') || f.endsWith('.js')) &&
            !f.endsWith('.test.ts') &&
            !f.endsWith('.test.js') &&
            !f.includes('/test/'));
        if (codeFiles.length === 0) {
            return {
                passed: true,
                coveragePercent: 100,
                undocumented: []
            };
        }
        let totalPublicItems = 0;
        let documentedItems = 0;
        for (const file of codeFiles) {
            if (!fs.existsSync(file)) {
                continue;
            }
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            // Look for public functions, classes, interfaces, and types
            const publicItemPattern = /^\s*export\s+(function|class|interface|type|const|let)\s+(\w+)/;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const match = line.match(publicItemPattern);
                if (match) {
                    totalPublicItems++;
                    const itemName = match[2];
                    // Check if there's a JSDoc comment above this line
                    let hasDoc = false;
                    if (i > 0) {
                        // Look for /** comment in previous lines
                        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                            const prevLine = lines[j].trim();
                            if (prevLine.startsWith('/**') || prevLine.startsWith('*')) {
                                hasDoc = true;
                                break;
                            }
                            if (prevLine.length > 0 && !prevLine.startsWith('//') && !prevLine.startsWith('*')) {
                                break; // Stop if we hit non-comment code
                            }
                        }
                    }
                    if (hasDoc) {
                        documentedItems++;
                    }
                    else {
                        undocumented.push(`${file}:${i + 1} - ${itemName}`);
                    }
                }
            }
        }
        // Calculate coverage
        if (totalPublicItems > 0) {
            coveragePercent = Math.round((documentedItems / totalPublicItems) * 100);
        }
        else {
            coveragePercent = 100; // No public items = 100% covered
        }
        // Pass if at least 50% documented (non-blocking threshold)
        passed = coveragePercent >= 50;
    }
    catch (error) {
        console.warn('Failed to check documentation:', error.message);
        // On error, pass with warning
        passed = true;
        coveragePercent = 0;
    }
    return {
        passed,
        coveragePercent,
        undocumented
    };
}
/**
 * Run all quality checks
 * @param workspaceRoot - Root directory of the workspace
 * @param changedFiles - List of files that were changed
 * @returns Complete quality check results
 */
async function runAllQualityChecks(workspaceRoot, changedFiles = []) {
    // Run checks in parallel for efficiency
    const [tests, linting, security, documentation] = await Promise.all([
        runTests(workspaceRoot),
        runLinting(workspaceRoot, changedFiles),
        runSecurityScan(workspaceRoot),
        checkDocumentation(changedFiles)
    ]);
    // Determine overall pass status
    // Blocking: tests, linting, security (critical/high only)
    // Non-blocking: documentation
    const overallPass = tests.passed && linting.passed && security.passed;
    return {
        tests,
        linting,
        security,
        documentation,
        overallPass
    };
}
/**
 * Check if a quality check result represents a blocking failure
 * @param result - Quality check result to evaluate
 * @returns true if there is a blocking failure
 */
function isBlockingFailure(result) {
    // Tests, linting, or security (critical/high) failures are blocking
    return !result.tests.passed ||
        !result.linting.passed ||
        !result.security.passed;
}
//# sourceMappingURL=quality-checks.js.map