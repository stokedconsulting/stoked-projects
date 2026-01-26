import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GitHubOAuthService {
  private clientId: string;
  private clientSecret: string;
  private callbackUrl: string;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    this.clientId = this.configService.get<string>('github.oauth.clientId')!;
    this.clientSecret = this.configService.get<string>('github.oauth.clientSecret')!;
    this.callbackUrl = this.configService.get<string>('github.oauth.callbackUrl')!;
  }

  /**
   * Get the GitHub OAuth authorization URL
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: 'repo read:org read:project project',
    });

    if (state) {
      params.append('state', state);
    }

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  /**
   * Get GitHub user info using access token
   */
  async getUserInfo(accessToken: string): Promise<any> {
    const octokit = new Octokit({ auth: accessToken });
    const { data } = await octokit.users.getAuthenticated();
    return data;
  }

  /**
   * Complete OAuth flow: exchange code, get user info, create/update user
   */
  async handleCallback(code: string): Promise<{ user: any; token: string }> {
    // Exchange code for token
    const accessToken = await this.exchangeCodeForToken(code);

    // Get user info from GitHub
    const githubUser = await this.getUserInfo(accessToken);

    // Create or update user in database
    const user = await this.usersService.createOrUpdate({
      github_id: githubUser.id.toString(),
      github_login: githubUser.login,
      github_name: githubUser.name,
      github_email: githubUser.email,
      github_avatar_url: githubUser.avatar_url,
      access_token: accessToken,
    });

    return { user, token: accessToken };
  }
}
