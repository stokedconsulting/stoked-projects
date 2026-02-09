import {
  Controller,
  Get,
  Query,
  Res,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { GitHubOAuthService } from './github-oauth.service';

@Controller('api/auth/github')
export class GitHubOAuthController {
  constructor(private githubOAuthService: GitHubOAuthService) {}

  /**
   * Redirect to GitHub OAuth authorization page
   * GET /api/auth/github/login
   */
  @Get('login')
  login(@Res() res: Response, @Query('redirect_uri') redirectUri?: string) {
    // Generate state token for CSRF protection
    const state = redirectUri ? Buffer.from(redirectUri).toString('base64') : undefined;

    // Get GitHub OAuth URL
    const authUrl = this.githubOAuthService.getAuthorizationUrl(state);

    // Redirect to GitHub
    res.redirect(authUrl);
  }

  /**
   * OAuth callback endpoint
   * GET /api/auth/github/callback
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      if (!code) {
        throw new HttpException(
          'Authorization code missing',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Complete OAuth flow
      const { user, token } = await this.githubOAuthService.handleCallback(code);

      // Decode redirect URI from state
      let redirectUri = 'vscode://stokedconsulting.claude-projects/auth-callback';
      if (state) {
        try {
          redirectUri = Buffer.from(state, 'base64').toString('utf-8');
        } catch (e) {
          // Ignore decode errors, use default
        }
      }

      // Redirect back to extension with token
      const callbackUrl = `${redirectUri}?token=${token}&user=${encodeURIComponent(JSON.stringify({
        id: user.github_id,
        login: user.github_login,
        name: user.github_name,
        avatar_url: user.github_avatar_url,
      }))}`;

      res.redirect(callbackUrl);
    } catch (error) {
      console.error('OAuth callback error:', error);

      // Show error page
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Error</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                text-align: center;
                max-width: 500px;
              }
              h1 { color: #e53e3e; margin-bottom: 20px; }
              p { color: #666; margin-bottom: 30px; }
              .error { background: #fee; padding: 15px; border-radius: 5px; color: #c53030; margin-top: 20px; }
              button {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
              }
              button:hover { opacity: 0.9; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Authentication Failed</h1>
              <p>We encountered an error while trying to authenticate with GitHub.</p>
              <div class="error">${error.message || 'Unknown error'}</div>
              <button onclick="window.close()">Close Window</button>
            </div>
          </body>
        </html>
      `);
    }
  }

  /**
   * Get current user info (requires authentication)
   * GET /api/auth/github/me
   */
  @Get('me')
  async getCurrentUser(@Query('token') token: string) {
    if (!token) {
      throw new HttpException('Token required', HttpStatus.UNAUTHORIZED);
    }

    try {
      const userInfo = await this.githubOAuthService.getUserInfo(token);
      return {
        id: userInfo.id,
        login: userInfo.login,
        name: userInfo.name,
        email: userInfo.email,
        avatar_url: userInfo.avatar_url,
      };
    } catch (error) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
