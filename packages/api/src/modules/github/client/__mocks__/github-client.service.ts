/**
 * Mock GitHubClientService for testing
 * This avoids ESM import issues with @octokit packages
 */
export class GitHubClientService {
  executeGraphQL = jest.fn();
  executeREST = jest.fn();
  getRateLimitInfo = jest.fn();
  getConnectionPoolStatus = jest.fn();
}
