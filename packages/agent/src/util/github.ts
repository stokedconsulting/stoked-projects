/**
 * GitHub API client for the agent package.
 *
 * ZERO vscode imports — pure Node.js using built-in fetch (Node 18+).
 *
 * Features:
 * - GraphQL execution with Authorization header
 * - Exponential backoff retry on rate limits (max 3 retries)
 * - 30-second per-request timeout
 * - Descriptive error messages for network and GraphQL errors
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

interface RateLimitInfo {
  remaining: number;
  reset: number; // Unix timestamp (seconds)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// GitHubClient
// ---------------------------------------------------------------------------

export class GitHubClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  // -------------------------------------------------------------------------
  // Low-level GraphQL executor
  // -------------------------------------------------------------------------

  /**
   * Execute a GraphQL query against the GitHub API.
   * Retries up to {@link MAX_RETRIES} times on rate-limit responses (HTTP 429
   * or `X-RateLimit-Remaining: 0`) using exponential back-off.
   *
   * @param query     GraphQL query or mutation string
   * @param variables Optional variables object
   * @returns         The `data` field from the GitHub response
   * @throws          On network errors, timeouts, or GraphQL errors
   */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 1_000; // 2s, 4s, 8s
        await sleep(backoffMs);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(GITHUB_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            Authorization: `bearer ${this.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(
            `GitHub GraphQL request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s`,
          );
        } else {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
        // Network errors are not retryable in the same way — still retry to
        // handle transient connectivity issues.
        continue;
      }

      clearTimeout(timeoutId);

      // Check rate-limit headers before parsing body
      const rateLimitInfo = extractRateLimitInfo(response);
      if (response.status === 429 || (rateLimitInfo && rateLimitInfo.remaining === 0)) {
        const waitMs = rateLimitInfo
          ? Math.max(0, rateLimitInfo.reset * 1_000 - Date.now()) + 1_000
          : (attempt + 1) * 2_000;

        lastError = new Error(
          `GitHub rate limit exceeded; waiting ${Math.ceil(waitMs / 1_000)}s before retry`,
        );

        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
        break;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = new Error(
          `GitHub API HTTP ${response.status}: ${response.statusText}. Body: ${body}`,
        );
        // 5xx errors are retryable; 4xx (except 429) are not
        if (response.status < 500) {
          break;
        }
        continue;
      }

      const json: GraphQLResponse<T> = await response.json();

      if (json.errors && json.errors.length > 0) {
        const messages = json.errors.map((e) => e.message).join('; ');
        throw new Error(`GitHub GraphQL error(s): ${messages}`);
      }

      if (json.data === undefined) {
        throw new Error('GitHub GraphQL response contained no data field');
      }

      return json.data;
    }

    throw lastError ?? new Error('GitHub GraphQL request failed after retries');
  }

  // -------------------------------------------------------------------------
  // High-level helpers
  // -------------------------------------------------------------------------

  /**
   * Returns the count of open issues for the given repository.
   */
  async getOpenIssueCount(owner: string, repo: string): Promise<number> {
    const query = `
      query GetOpenIssueCount($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          openIssues: issues(states: OPEN) {
            totalCount
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: { openIssues: { totalCount: number } };
    }>(query, { owner, repo });

    return data.repository.openIssues.totalCount;
  }

  /**
   * Updates the status field of a project item via the
   * `updateProjectV2ItemFieldValue` mutation.
   *
   * @param projectId     Node ID of the GitHub Project (V2)
   * @param itemId        Node ID of the project item
   * @param statusFieldId Node ID of the Status field
   * @param statusValue   Single-select option ID for the desired status
   */
  async updateIssueStatus(
    projectId: string,
    itemId: string,
    statusFieldId: string,
    statusValue: string,
  ): Promise<void> {
    const mutation = `
      mutation UpdateProjectItemStatus(
        $projectId: ID!
        $itemId: ID!
        $fieldId: ID!
        $value: ProjectV2FieldValue!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: $value
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await this.graphql(mutation, {
      projectId,
      itemId,
      fieldId: statusFieldId,
      value: { singleSelectOptionId: statusValue },
    });
  }

  /**
   * Atomically assign an issue (project item) to an agent by updating the
   * assignee field.  Returns `true` if the update succeeded.
   *
   * @param projectId Node ID of the GitHub Project (V2)
   * @param itemId    Node ID of the project item
   * @param agentId   String identifier used as the assignee value
   */
  async claimIssue(
    projectId: string,
    itemId: string,
    agentId: string,
  ): Promise<boolean> {
    const mutation = `
      mutation ClaimProjectItem(
        $projectId: ID!
        $itemId: ID!
        $text: String!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $itemId
            value: { text: $text }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    try {
      await this.graphql(mutation, { projectId, itemId, text: agentId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a new issue in the given repository.
   *
   * @param owner   Repository owner (user or org login)
   * @param repo    Repository name
   * @param title   Issue title
   * @param body    Issue body (markdown)
   * @param labels  Optional label names to attach
   * @returns       The new issue's number and node ID
   */
  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<{ number: number; id: string }> {
    // Step 1: look up the repository node ID (required for createIssue mutation)
    const repoQuery = `
      query GetRepoId($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `;

    const repoData = await this.graphql<{ repository: { id: string } }>(repoQuery, {
      owner,
      repo,
    });

    const repositoryId = repoData.repository.id;

    // Step 2: create the issue
    const mutation = `
      mutation CreateIssue(
        $repositoryId: ID!
        $title: String!
        $body: String!
        $labelIds: [ID!]
      ) {
        createIssue(
          input: {
            repositoryId: $repositoryId
            title: $title
            body: $body
            labelIds: $labelIds
          }
        ) {
          issue {
            number
            id
          }
        }
      }
    `;

    let labelIds: string[] | undefined;
    if (labels && labels.length > 0) {
      labelIds = await this.resolveLabelIds(owner, repo, labels);
    }

    const createData = await this.graphql<{
      createIssue: { issue: { number: number; id: string } };
    }>(mutation, {
      repositoryId,
      title,
      body,
      labelIds: labelIds ?? null,
    });

    return createData.createIssue.issue;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolves an array of label names into their GraphQL node IDs.
   * Labels that don't exist in the repository are silently skipped.
   */
  private async resolveLabelIds(
    owner: string,
    repo: string,
    labelNames: string[],
  ): Promise<string[]> {
    const query = `
      query GetLabelIds($owner: String!, $repo: String!, $first: Int!) {
        repository(owner: $owner, name: $repo) {
          labels(first: $first) {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: { labels: { nodes: Array<{ id: string; name: string }> } };
    }>(query, { owner, repo, first: 100 });

    const nameToId = new Map(
      data.repository.labels.nodes.map((l) => [l.name.toLowerCase(), l.id]),
    );

    return labelNames
      .map((name) => nameToId.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined);
  }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRateLimitInfo(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  if (remaining === null || reset === null) {
    return null;
  }
  return {
    remaining: parseInt(remaining, 10),
    reset: parseInt(reset, 10),
  };
}
