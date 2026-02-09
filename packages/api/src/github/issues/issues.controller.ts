import {
  Controller,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IssuesService } from './issues.service';
import { ApiKeyGuard } from '../../modules/auth/guards/api-key.guard';

@ApiTags('github-issues')
@Controller('api/github/repos/:owner/:repo/issues')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post(':issueNumber/close')
  @ApiOperation({ summary: 'Close an issue' })
  @ApiResponse({ status: 200, description: 'Issue closed successfully' })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  @ApiResponse({ status: 400, description: 'Failed to close issue' })
  async closeIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('issueNumber', ParseIntPipe) issueNumber: number,
  ): Promise<{ success: boolean; state: string }> {
    return this.issuesService.closeIssue(owner, repo, issueNumber);
  }
}
