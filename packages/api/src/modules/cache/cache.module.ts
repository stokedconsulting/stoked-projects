import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';
import { ProjectCache, ProjectCacheSchema } from '../../schemas/project-cache.schema';
import { ItemCache, ItemCacheSchema } from '../../schemas/item-cache.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProjectCache.name, schema: ProjectCacheSchema },
      { name: ItemCache.name, schema: ItemCacheSchema },
    ]),
    UsersModule, // Need UsersService to get user tokens
  ],
  controllers: [CacheController],
  providers: [CacheService],
  exports: [CacheService], // Export for use in other modules
})
export class CacheModule {}
