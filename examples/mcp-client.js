#!/usr/bin/env node
/**
 * MCP Client Wrapper for Shell Scripts
 *
 * Provides a command-line interface to call MCP server tools from bash scripts.
 * Replaces direct `gh` CLI calls with MCP tool invocations.
 *
 * Usage:
 *   ./mcp-client.js close-issue --number 123
 *   ./mcp-client.js update-issue --number 123 --status "Done"
 *   ./mcp-client.js list-projects --owner stoked --repo claude-projects
 *
 * Environment:
 *   GITHUB_TOKEN - GitHub personal access token (required)
 *   MCP_SERVER_URL - Optional MCP server URL (default: local stdio)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get GitHub token from environment
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable required');
  console.error('Set it with: export GITHUB_TOKEN=your_github_token');
  process.exit(1);
}

/**
 * Call MCP tool by directly importing and calling the GitHub client
 * This approach bypasses the MCP protocol for simplicity in scripts
 */
async function callGitHubOperation(operation, params) {
  const { Octokit } = require('@octokit/rest');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  switch (operation) {
    case 'close-issue':
      return await octokit.issues.update({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.number,
        state: 'closed',
      });

    case 'create-issue':
      return await octokit.issues.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body || '',
        labels: params.labels || [],
      });

    case 'update-issue':
      const updateParams = {
        owner: params.owner,
        repo: params.repo,
        issue_number: params.number,
      };
      if (params.title) updateParams.title = params.title;
      if (params.body) updateParams.body = params.body;
      if (params.state) updateParams.state = params.state;
      if (params.labels) updateParams.labels = params.labels;

      return await octokit.issues.update(updateParams);

    case 'get-issue':
      return await octokit.issues.get({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.number,
      });

    case 'list-issues':
      return await octokit.issues.listForRepo({
        owner: params.owner,
        repo: params.repo,
        state: params.state || 'all',
        per_page: params.limit || 30,
      });

    case 'list-projects':
      // Use GraphQL for ProjectsV2
      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 20) {
              nodes {
                id
                number
                title
                url
              }
            }
          }
        }
      `;

      return await octokit.graphql(query, {
        owner: params.owner,
        repo: params.repo,
      });

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: mcp-client.js <operation> [options]');
    console.error('\nOperations:');
    console.error('  close-issue     - Close a GitHub issue');
    console.error('  create-issue    - Create a new GitHub issue');
    console.error('  update-issue    - Update an existing issue');
    console.error('  get-issue       - Get issue details');
    console.error('  list-issues     - List repository issues');
    console.error('  list-projects   - List repository projects');
    console.error('\nCommon Options:');
    console.error('  --owner, -o     - Repository owner');
    console.error('  --repo, -r      - Repository name');
    console.error('  --number, -n    - Issue number');
    console.error('  --title         - Issue title');
    console.error('  --body          - Issue body');
    console.error('  --state         - Issue state (open/closed)');
    console.error('  --labels        - Comma-separated labels');
    process.exit(1);
  }

  const operation = args[0];
  const params = {};

  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--?/, '');
    const value = args[i + 1];

    switch (key) {
      case 'owner':
      case 'o':
        params.owner = value;
        break;
      case 'repo':
      case 'r':
        params.repo = value;
        break;
      case 'number':
      case 'n':
        params.number = parseInt(value, 10);
        break;
      case 'title':
        params.title = value;
        break;
      case 'body':
        params.body = value;
        break;
      case 'state':
        params.state = value;
        break;
      case 'labels':
        params.labels = value.split(',').map(l => l.trim());
        break;
      case 'limit':
        params.limit = parseInt(value, 10);
        break;
      default:
        console.warn(`Unknown option: --${key}`);
    }
  }

  // Auto-detect owner/repo from git if not provided
  if (!params.owner || !params.repo) {
    try {
      const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
      const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        params.owner = params.owner || match[1];
        params.repo = params.repo || match[2];
      }
    } catch (err) {
      // Ignore if not in a git repo
    }
  }

  return { operation, params };
}

/**
 * Main entry point
 */
async function main() {
  try {
    const { operation, params } = parseArgs();

    // Validate required params
    if (!params.owner || !params.repo) {
      console.error('Error: --owner and --repo are required (or run from a git repository)');
      process.exit(1);
    }

    console.error(`[mcp-client] Operation: ${operation}`);
    console.error(`[mcp-client] Params:`, JSON.stringify(params, null, 2));

    const result = await callGitHubOperation(operation, params);

    // Output result as JSON
    console.log(JSON.stringify(result.data || result, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('GitHub API Error:', error.response.data);
    }
    process.exit(1);
  }
}

main();
