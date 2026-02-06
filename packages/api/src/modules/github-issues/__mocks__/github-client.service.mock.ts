/**
 * Mock for GitHubClientService to avoid ESM import issues in tests
 */
export const mockGitHubClient = {
  executeGraphQL: jest.fn(),
  executeREST: jest.fn(),
  getRateLimitInfo: jest.fn(),
  getConnectionPoolStatus: jest.fn(),
};

export class GitHubClientService {
  executeGraphQL = mockGitHubClient.executeGraphQL;
  executeREST = mockGitHubClient.executeREST;
  getRateLimitInfo = mockGitHubClient.getRateLimitInfo;
  getConnectionPoolStatus = mockGitHubClient.getConnectionPoolStatus;
}
