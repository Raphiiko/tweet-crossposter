import { Module } from '@nestjs/common';
import { TwitterService } from './services/twitter.service';
import { ConfigModule } from '@nestjs/config';
import { BlueskyService } from './services/bluesky.service';
import { MastodonService } from './services/mastodon.service';
import { SyncService } from './services/sync.service';
import { MediaCacheService } from './services/media-cache.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [],
  providers: [
    TwitterService,
    BlueskyService,
    MastodonService,
    SyncService,
    MediaCacheService,
  ],
})
export class AppModule {}
