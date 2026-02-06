import { Module, DynamicModule, Global } from '@nestjs/common';
import { GitHubClientService } from './client/github-client.service';
import { GitHubClientConfig } from './client/github-client.types';

/**
 * GitHub Module
 *
 * Provides unified GitHub API client services
 */
@Global()
@Module({})
export class GitHubModule {
  /**
   * Register GitHub module with configuration
   */
  static forRoot(config: GitHubClientConfig): DynamicModule {
    return {
      module: GitHubModule,
      providers: [
        {
          provide: 'GITHUB_CLIENT_CONFIG',
          useValue: config,
        },
        {
          provide: GitHubClientService,
          useFactory: (config: GitHubClientConfig) => {
            return new GitHubClientService(config);
          },
          inject: ['GITHUB_CLIENT_CONFIG'],
        },
      ],
      exports: [GitHubClientService],
    };
  }

  /**
   * Register GitHub module asynchronously (for ConfigService)
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<GitHubClientConfig> | GitHubClientConfig;
    inject?: any[];
  }): DynamicModule {
    return {
      module: GitHubModule,
      providers: [
        {
          provide: 'GITHUB_CLIENT_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: GitHubClientService,
          useFactory: (config: GitHubClientConfig) => {
            return new GitHubClientService(config);
          },
          inject: ['GITHUB_CLIENT_CONFIG'],
        },
      ],
      exports: [GitHubClientService],
    };
  }
}
