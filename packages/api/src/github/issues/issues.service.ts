import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { GitHubAuthService } from '../auth/github-auth.service';

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(private readonly githubAuth: GitHubAuthService) {}

  /**
   * Get authenticated Octokit instance
   */
  private async getOctokit(): Promise<Octokit> {
    const tokenMetadata = await this.githubAuth.getToken(['repo']);

    return new Octokit({
      auth: tokenMetadata.token,
      userAgent: 'api/1.0.0',
    });
  }

  /**
   * Execute GraphQL query against GitHub API
   */
  private async fetchGraphQL(
    query: string,
    variables: any,
  ): Promise<{ data: any; errors: any[] | null }> {
    const octokit = await this.getOctokit();

    try {
      const response = await octokit.graphql(query, variables);
      return {
        data: response,
        errors: null,
      };
    } catch (error: any) {
      this.logger.error('GraphQL query failed', { error: error.message, variables });

      if (error.errors) {
        return {
          data: null,
          errors: error.errors,
        };
      }

      throw new HttpException(
        `GitHub API error: ${error.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Close an issue
   */
  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<{ success: boolean; state: string }> {
    // First, get the issue ID
    const getIdQuery = `
      query($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issueOrPullRequest(number: $issueNumber) {
            ... on Issue {
              id
            }
            ... on PullRequest {
              id
            }
          }
        }
      }
    `;

    const { data: idData, errors: idErrors } = await this.fetchGraphQL(getIdQuery, {
      owner,
      repo,
      issueNumber,
    });

    if (idErrors || !idData?.repository?.issueOrPullRequest?.id) {
      this.logger.error('Failed to get issue ID', { owner, repo, issueNumber, errors: idErrors });
      throw new HttpException('Issue not found', HttpStatus.NOT_FOUND);
    }

    const issueId = idData.repository.issueOrPullRequest.id;

    // Close the issue
    const closeQuery = `
      mutation($issueId: ID!) {
        closeIssue(input: {
          issueId: $issueId
        }) {
          issue {
            id
            state
          }
        }
      }
    `;

    const { data, errors } = await this.fetchGraphQL(closeQuery, { issueId });

    if (errors) {
      this.logger.error('Close issue failed', { errors });
      throw new HttpException('Failed to close issue', HttpStatus.BAD_REQUEST);
    }

    return {
      success: true,
      state: data?.closeIssue?.issue?.state || 'CLOSED',
    };
  }
}
