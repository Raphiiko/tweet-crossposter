import { Injectable } from '@nestjs/common';
import {
  BehaviorSubject,
  combineLatest,
  filter,
  firstValueFrom,
  interval,
  startWith,
} from 'rxjs';
import { BlueskyService } from './bluesky.service';
import { MastodonPostOptions, MastodonService } from './mastodon.service';
import { TwitterService } from './twitter.service';
import { Tweet } from '../models/tweet.model';
import { MediaCacheService } from './media-cache.service';
import { AppBskyFeedPost } from '@atproto/api/src/client';
import { RichText } from '@atproto/api';
import flatCache from 'flat-cache';
import { uniq } from 'lodash';
import { mkdirp } from 'mkdirp';

@Injectable()
export class SyncService {
  private _initialized = new BehaviorSubject<boolean>(false);
  public initialized = this._initialized.asObservable();
  private syncAfterTimestamp =
    parseInt(process.env.SYNC_AFTER_TIMESTAMP || '0') ||
    Math.floor(Date.now() / 1000);
  private syncedTweetIds: string[] = [];
  private cache: flatCache.Cache;

  constructor(
    private twitter: TwitterService,
    private bluesky: BlueskyService,
    private mastodon: MastodonService,
    private mediaCache: MediaCacheService,
  ) {
    this.init();
  }

  private async init() {
    if (this._initialized.value) return;
    console.log('Initializing Sync Service...');
    // Load synced tweet ids
    const cacheDir = process.env.PERSISTENT_DATA_PATH ?? './data';
    await mkdirp(cacheDir);
    this.cache = flatCache.load('SyncService', cacheDir);
    this.syncedTweetIds = this.cache.getKey('syncedTweetIds') || [];
    await firstValueFrom(
      combineLatest([
        this.twitter.initialized,
        this.bluesky.initialized,
        this.mastodon.initialized,
      ]).pipe(
        filter(
          ([twitter, bluesky, mastodon]) => twitter && bluesky && mastodon,
        ),
      ),
    );
    this.startSyncTimer();
    console.log('Sync Service Initialized');
    this._initialized.next(true);
  }

  private startSyncTimer() {
    interval(parseInt(process.env.SYNC_INTERVAL || (15 * 60 * 1000).toString()))
      .pipe(startWith(0))
      .subscribe(() => this.sync());
  }

  private async sync() {
    const tweets = await this.twitter.getRecentTweets();
    // Filter out tweets that have already been synced
    let toSync = (
      await Promise.all(
        tweets.map((tweet) =>
          this.tweetHasSynced(tweet.id).then((hasSynced) =>
            hasSynced ? null : tweet,
          ),
        ),
      )
    ).filter(Boolean);
    // Filter out replies to other people
    toSync = toSync.filter(
      (t) => !t.replyTo || t.replyTo.userId === process.env.TWITTER_USER_ID,
    );
    // TODO: Filter out all replies until we know how to handle them
    toSync = toSync.filter((t) => !t.replyTo);
    // Filter out tweets that are too old
    toSync = toSync.filter((t) => t.timestamp >= this.syncAfterTimestamp);
    // Sort toSync by timestamp ascending
    toSync = toSync.sort((a, b) => a.timestamp - b.timestamp);
    // Sync tweets
    for (const tweet of toSync) {
      await Promise.all(
        (tweet.photos || []).map((photo) =>
          this.mediaCache.cacheMedia(photo.url),
        ),
      );
      await Promise.all(
        (tweet.videos || []).map((video) =>
          this.mediaCache.cacheMedia(video.url),
        ),
      );
      let syncedToMastodon = false;
      try {
        await this.syncToMastodon(tweet);
        syncedToMastodon = true;
      } catch (e) {
        console.error('Could not sync tweet to Mastodon: ' + e);
      }
      let syncedToBluesky = false;
      try {
        await this.syncToBluesky(tweet);
        syncedToBluesky = true;
      } catch (e) {
        console.error('Could not sync tweet to Bluesky: ' + e);
      }
      if (syncedToBluesky || syncedToMastodon) this.markTweetSynced(tweet.id);
      await Promise.all(
        (tweet.photos || []).map((photo) =>
          this.mediaCache.uncacheMedia(photo.url),
        ),
      );
      await Promise.all(
        (tweet.videos || []).map((video) =>
          this.mediaCache.uncacheMedia(video.url),
        ),
      );
    }
  }

  private async tweetHasSynced(tweetId: string): Promise<boolean> {
    return this.syncedTweetIds.includes(tweetId);
  }

  private async syncToMastodon(tweet: Tweet) {
    let text = tweet.text;
    const options: MastodonPostOptions = {};
    if (tweet.quotedTweetUrl) {
      text += '\n\nQRT:' + tweet.quotedTweetUrl;
    }
    if (tweet.photos) {
      for (const photo of tweet.photos) {
        try {
          const upload = await this.mastodon.uploadMedia(
            this.mediaCache.getFilePathForUrl(photo.url),
          );
          options.media_ids ??= [];
          options.media_ids.push(upload.id);
        } catch (e) {
          console.error(
            'Could not upload image to Mastodon. Skipping sync on this tweet. Error: ' +
              e,
            JSON.stringify(e, null, 2),
          );

          return;
        }
      }
    }
    if (tweet.videos) {
      for (const video of tweet.videos) {
        try {
          const upload = await this.mastodon.uploadMedia(
            this.mediaCache.getFilePathForUrl(video.url),
          );
          options.media_ids ??= [];
          options.media_ids.push(upload.id);
        } catch (e) {
          console.error(
            'Could not upload video to Mastodon. Skipping sync on this tweet. Error: ' +
              e,
          );
          return;
        }
      }
    }
    await this.mastodon.post(text, options);
    console.log('Synced tweet to Mastodon!');
  }

  private async syncToBluesky(tweet: Tweet) {
    const post: Partial<AppBskyFeedPost.Record> &
      Omit<AppBskyFeedPost.Record, 'createdAt'> = {};
    let text = tweet.text;
    if (tweet.quotedTweetUrl) {
      text += '\n\nQRT:' + tweet.quotedTweetUrl;
    }
    // Add links to videos (as bluesky doesn't support videos yet)
    if (tweet.videos) {
      tweet.videos.forEach((video) => {
        text += '\n' + video.shortUrl;
      });
    }
    if (tweet.photos) {
      for (const photo of tweet.photos) {
        try {
          const upload = await this.bluesky.uploadImage(
            this.mediaCache.getFilePathForUrl(photo.url),
          );
          post.embed ??= {
            $type: 'app.bsky.embed.images',
          };
          post.embed.images ??= [];
          (post.embed.images as any[]).push({
            image: upload.data.blob,
            alt: '',
          });
        } catch (e) {
          console.error(
            'Could not upload image to Bluesky. Skipping sync on this tweet. Error: ' +
              e,
          );
        }
      }
    }
    const rt = new RichText({ text });
    await rt.detectFacets(this.bluesky.agent);
    post.text = rt.text;
    post.facets = rt.facets;
    post.$type = 'app.bsky.feed.post';
    await this.bluesky.post(post);
    console.log('Synced tweet to Bluesky!');
  }

  private markTweetSynced(tweetId: string) {
    this.syncedTweetIds.push(tweetId);
    this.syncedTweetIds = uniq(this.syncedTweetIds);
    this.cache.setKey('syncedTweetIds', this.syncedTweetIds);
    this.cache.save(true);
  }
}
