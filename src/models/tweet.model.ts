export interface Tweet {
  id: string;
  text: string;
  timestamp: number;
  quotedTweetUrl?: string;
  quotedTweet?: Tweet;
  photos?: TweetPhoto[];
  videos?: TweetVideo[];
  replyTo?: {
    userId?: string;
    tweetId?: string;
  };
}

export interface TweetPhoto {
  url: string;
  shortUrl: string;
}

export interface TweetVideo {
  url: string;
  shortUrl: string;
}
