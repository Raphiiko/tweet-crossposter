import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer-extra';
import { flatten } from 'lodash';
import { Tweet } from '../models/tweet.model';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import { Browser, Page } from 'puppeteer';
import { BehaviorSubject } from 'rxjs';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

@Injectable()
export class TwitterService {
  private browser: Browser;
  private page: Page;
  private _initialized = new BehaviorSubject<boolean>(false);
  public initialized = this._initialized.asObservable();

  constructor() {
    this.init();
  }

  public async getRecentTweets(): Promise<Tweet[]> {
    if (!this._initialized.value) throw 'PUPPETEER_NOT_INITIALIZED';
    await this.page.goto(
      'https://twitter.com/' + process.env.TWITTER_USER_HANDLE,
    );
    const response = await this.page.waitForResponse(
      (response) =>
        response.url().includes('graphql') &&
        response.url().includes('/UserTweets'),
    );
    const data = await response.json();
    await this.page.goto('about:blank');
    return (
      flatten(
        data.data.user.result.timeline_v2.timeline.instructions
          .find((i) => i.type === 'TimelineAddEntries')
          .entries.map((e) => {
            if (e.entryId.startsWith('tweet-'))
              return [e.content.itemContent.tweet_results.result];
            if (e.entryId.startsWith('profile-conversation-')) {
              return e.content.items.map(
                (i) => i.item.itemContent.tweet_results.result,
              );
            }
            return null;
          })
          .filter(Boolean),
      )
        // Filter by user
        .filter(
          (t: any) =>
            t.core.user_results.result.rest_id === process.env.TWITTER_USER_ID,
        )
        // Filter out retweets
        .filter((t: any) => !t.legacy.retweeted_status_result)
        // Map remaining tweets
        .map((t: any) => this.mapTweet(t))
    );
  }

  public async isLoggedIn(): Promise<boolean> {
    await this.page.goto(
      'https://twitter.com/' + process.env.TWITTER_USER_HANDLE,
    );
    try {
      await this.page.waitForNetworkIdle();
    } catch (e) {}
    return (
      this.page.url() ===
      'https://twitter.com/' + process.env.TWITTER_USER_HANDLE
    );
  }

  public async login(
    userEmail: string,
    userHandle: string,
    password: string,
  ): Promise<void> {
    await this.page.goto('https://twitter.com/i/flow/login');
    await this.page.waitForNetworkIdle({ idleTime: 1500 });
    // Select the user input
    await this.page.waitForSelector('[autocomplete=username]');
    await this.page.type('input[autocomplete=username]', userEmail, {
      delay: 50,
    });
    // Press the Next button
    await this.page.evaluate(() =>
      (document.querySelectorAll('div[role="button"]')[2] as any).click(),
    );
    await this.page.waitForNetworkIdle({ idleTime: 1500 });
    // Sometimes twitter suspect suspicious activties, so it ask for your handle/phone Number
    const extractedText = await this.page.$eval(
      '*',
      (el) => (el as any).innerText,
    );
    if (extractedText.includes('Enter your phone number or username')) {
      await this.page.waitForSelector('[autocomplete=on]');
      await this.page.type('input[autocomplete=on]', userHandle, { delay: 50 });
      await this.page.evaluate(() =>
        (document.querySelectorAll('div[role="button"]')[1] as any).click(),
      );
      await this.page.waitForNetworkIdle({ idleTime: 1500 });
    }
    // Select the password input
    await this.page.waitForSelector('[autocomplete="current-password"]');
    await this.page.type('[autocomplete="current-password"]', password, {
      delay: 50,
    });
    // Press the Login button
    await this.page.evaluate(() => {
      (document.querySelectorAll('div[role="button"]')[2] as any).click();
    });
    await this.page.waitForNetworkIdle({ idleTime: 2000 });
    await this.page.goto('about:blank');
  }

  private mapTweet(tweet: any): Tweet {
    const result: Tweet = {
      id: tweet.rest_id,
      timestamp: Math.floor(
        new Date(
          tweet.legacy.created_at.replace(
            /^\w+ (\w+) (\d+) ([\d:]+) \+0000 (\d+)$/,
            '$1 $2 $4 $3 UTC',
          ),
        ).getTime() / 1000,
      ),
      text: tweet.legacy.full_text,
    };
    // Parse media
    const mediaEntities = [];
    if (tweet.legacy.extended_entities?.media?.length) {
      mediaEntities.push(...tweet.legacy.extended_entities.media);
    }
    if (tweet.legacy.entities?.media?.length) {
      tweet.legacy.entities.media
        .filter((m) => !mediaEntities.some((_m) => _m.id_str === m.id_str))
        .forEach((m: any) => mediaEntities.push(m));
    }
    if (mediaEntities.length) {
      // Parse photos
      result.photos = mediaEntities
        .map((m: any) => {
          if (m.type !== 'photo') return null;
          return {
            url: m.media_url_https,
            shortUrl: m.url,
          };
        })
        .filter(Boolean);
      if (!result.photos.length) delete result.photos;
      // Remove photo urls from text
      mediaEntities.forEach((m: any) => {
        result.text = result.text.replaceAll(m.url, '').trim();
      });
      // Parse videos
      result.videos = mediaEntities
        .map((m: any) => {
          if (m.type !== 'video') return null;
          const variant = m.video_info.variants
            .filter((v) => v.content_type === 'video/mp4')
            .sort((a, b) => b.bitrate - a.bitrate)[0];
          if (!variant) return null;
          return {
            url: variant.url,
            shortUrl: m.url,
          };
        })
        .filter(Boolean);
      if (!result.videos.length) delete result.videos;
    }
    // Replace urls in text
    if (tweet.legacy.entities?.urls?.length) {
      tweet.legacy.entities.urls.forEach((u: any) => {
        result.text = result.text.replaceAll(u.url, u.expanded_url).trim();
      });
    }
    // Get the quoted tweet url
    if (tweet.legacy.quoted_status_permalink) {
      result.quotedTweetUrl = tweet.legacy.quoted_status_permalink.url;
    }
    // Parse the quoted tweet too
    if (tweet.quoted_status_result) {
      result.quotedTweet = this.mapTweet(tweet.quoted_status_result.result);
    }
    // Parse the user id of the user this tweet is replying to
    if (tweet.legacy.in_reply_to_user_id_str) {
      result.replyTo ??= {};
      result.replyTo.userId = tweet.legacy.in_reply_to_user_id_str;
    }
    // Parse the id of the tweet this tweet is replying to
    if (tweet.legacy.in_reply_to_status_id_str) {
      result.replyTo ??= {};
      result.replyTo.tweetId = tweet.legacy.in_reply_to_status_id_str;
    }
    return result;
  }

  private async init() {
    if (this._initialized.value) return;
    console.log('Initializing Twitter Service...');
    this.browser = await puppeteer.launch({
      headless: false,
      userDataDir: process.env.PUPPETEER_PATH_USER_DATA || './puppeteer_data',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--font-render-hinting=none',
      ],
    });
    this.page = await this.browser.newPage();
    this.page.setViewport({ width: 1920, height: 1080 });
    console.log('Checking Twitter login state...');
    if (!(await this.isLoggedIn())) {
      console.log('Not logged in to Twitter, logging in...');
      await this.login(
        process.env.TWITTER_LOGIN_EMAIL,
        process.env.TWITTER_LOGIN_HANDLE,
        process.env.TWITTER_LOGIN_PASSWORD,
      );
      if (!(await this.isLoggedIn())) {
        console.log('Could not log in to Twitter!');
        process.exit(0);
      } else {
        console.log('Logged in to Twitter');
      }
    } else {
      console.log('Already logged in to Twitter');
    }
    console.log('Twitter service initialized');
    this._initialized.next(true);
  }
}
