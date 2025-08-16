const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const dotenv = require("dotenv");
const fs = require("fs-extra");
const path = require("path");
const input = require("input");

// Load environment variables
dotenv.config();

class TelegramToXPoster {
  constructor() {
    // Telegram configuration
    this.apiId = parseInt(process.env.TELEGRAM_API_ID);
    this.apiHash = process.env.TELEGRAM_API_HASH;
    this.groupName = process.env.TELEGRAM_GROUP;

    // Twitter configuration
    this.twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });

    // OpenAI configuration
    this.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Configuration
    this.downloadDir = process.env.DOWNLOAD_DIR || "./downloads";
    this.maxVideoSizeMB = parseInt(process.env.MAX_VIDEO_SIZE_MB) || 50;
    this.sessionFile = "./telegram_session.txt";
    this.processedVideosFile = "./processed_videos.json";
    this.offsetFile = "./video_offset.json";

    // Initialize Telegram client
    this.telegramClient = null;
    this.processedVideos = this.loadProcessedVideos();
    this.currentOffset = this.loadOffset();
  }

  async initialize() {
    console.log("🚀 Initializing Telegram to X Poster...");

    // Ensure download directory exists
    await fs.ensureDir(this.downloadDir);

    // Initialize Telegram client
    await this.initializeTelegramClient();

    console.log("✅ Initialization complete!");
  }

  async initializeTelegramClient() {
    console.log("📱 Setting up Telegram client...");

    // Load existing session if available
    let sessionString = "";
    try {
      if (await fs.pathExists(this.sessionFile)) {
        sessionString = await fs.readFile(this.sessionFile, "utf8");
        console.log("📂 Found existing Telegram session");
      }
    } catch (error) {
      console.log("⚠️  No existing session found, will create new one");
    }

    const session = new StringSession(sessionString);
    this.telegramClient = new TelegramClient(
      session,
      this.apiId,
      this.apiHash,
      {
        connectionRetries: 5,
      }
    );

    await this.telegramClient.start({
      phoneNumber: async () => {
        console.log("📞 Telegram authentication required");
        return await input.text(
          "Enter your phone number (with country code): "
        );
      },
      password: async () => {
        return await input.password("Enter your 2FA password: ");
      },
      phoneCode: async () => {
        return await input.text(
          "Enter the verification code sent to your phone: "
        );
      },
      onError: (err) => {
        console.error("❌ Telegram authentication error:", err);
      },
    });

    // Save session for future use
    const newSessionString = this.telegramClient.session.save();
    if (newSessionString !== sessionString) {
      await fs.writeFile(this.sessionFile, newSessionString);
      console.log("💾 Telegram session saved");
    }

    console.log("✅ Telegram client ready");
  }

  loadProcessedVideos() {
    try {
      if (fs.existsSync(this.processedVideosFile)) {
        const data = fs.readFileSync(this.processedVideosFile, "utf8");
        const processedData = JSON.parse(data);

        // Handle both old format (array) and new format (object with metadata)
        if (Array.isArray(processedData)) {
          // Convert old format to new format
          const videoSet = new Set(processedData);
          console.log(
            `📂 Loaded ${videoSet.size} processed videos (legacy format)`
          );
          return videoSet;
        } else {
          // New format with metadata
          const videoSet = new Set(processedData.videos || []);
          console.log(`📂 Loaded ${videoSet.size} processed videos`);
          return videoSet;
        }
      }
    } catch (error) {
      console.log("⚠️  Could not load processed videos list, starting fresh");
    }
    return new Set();
  }

  saveProcessedVideos() {
    try {
      const dataToSave = {
        lastUpdated: new Date().toISOString(),
        totalProcessed: this.processedVideos.size,
        videos: [...this.processedVideos],
      };

      fs.writeFileSync(
        this.processedVideosFile,
        JSON.stringify(dataToSave, null, 2)
      );
      console.log(
        `💾 Saved ${this.processedVideos.size} processed video records`
      );
    } catch (error) {
      console.error("❌ Error saving processed videos list:", error);
    }
  }

  loadOffset() {
    try {
      if (fs.existsSync(this.offsetFile)) {
        const data = fs.readFileSync(this.offsetFile, "utf8");
        const offsetData = JSON.parse(data);
        console.log(
          `📍 Loaded offset: ${offsetData.offset} (last updated: ${offsetData.lastUpdated})`
        );
        return offsetData.offset || 0;
      }
    } catch (error) {
      console.log("⚠️  Could not load offset, starting from beginning");
    }
    return 0;
  }

  saveOffset(newOffset) {
    try {
      const offsetData = {
        offset: newOffset,
        lastUpdated: new Date().toISOString(),
        totalProcessed: this.processedVideos.size,
      };

      fs.writeFileSync(this.offsetFile, JSON.stringify(offsetData, null, 2));
      console.log(`📍 Updated offset to: ${newOffset}`);
      this.currentOffset = newOffset;
    } catch (error) {
      console.error("❌ Error saving offset:", error);
    }
  }

  generateVideoId(message) {
    // Create a more robust unique identifier using multiple message properties
    const peerId =
      message.peerId?.channelId ||
      message.peerId?.chatId ||
      message.peerId?.userId ||
      "unknown";
    const messageId = message.id;
    const date = message.date;

    // Include video file properties for extra uniqueness
    const videoSize = message.video?.size || 0;
    const videoDuration = message.video?.duration || 0;

    return `${peerId}_${messageId}_${date}_${videoSize}_${videoDuration}`;
  }

  async findOldestUnprocessedVideo() {
    console.log("🔍 Searching for oldest unprocessed video...");

    try {
      const entity = await this.telegramClient.getEntity(this.groupName);
      console.log(`📺 Searching in: ${entity.title || this.groupName}`);

      const batchSize = 50; // Process in smaller batches for efficiency
      let currentBatch = 0;

      console.log(`📍 Starting search from offset: ${this.currentOffset}`);

      // Get video messages in batches, starting from our current offset
      for await (const message of this.telegramClient.iterMessages(entity, {
        filter: new Api.InputMessagesFilterVideo(),
        reverse: true, // Start from oldest
        limit: batchSize,
        offsetId: this.currentOffset > 0 ? this.currentOffset : undefined,
      })) {
        currentBatch++;

        const videoId = this.generateVideoId(message);

        // Check if this video has been processed
        if (!this.processedVideos.has(videoId)) {
          console.log(
            `🎯 Found oldest unprocessed video: Message ID ${
              message.id
            } (batch ${Math.ceil(currentBatch / batchSize)})`
          );
          return message;
        }

        // Show progress every 25 videos
        if (currentBatch % 25 === 0) {
          console.log(
            `📊 Checked ${currentBatch} videos from offset ${this.currentOffset}...`
          );
        }
      }

      // If we get here, we've checked all videos in this batch and found none unprocessed
      // This means we need to move to the next batch
      const newOffset = this.currentOffset + batchSize;
      console.log(
        `📍 No unprocessed videos in current batch. Moving to next batch (offset: ${newOffset})`
      );

      // Save the new offset for next run
      this.saveOffset(newOffset);

      console.log("ℹ️  No unprocessed videos found in current batch");
      return null;
    } catch (error) {
      console.error("❌ Error finding video:", error);
      throw error;
    }
  }

  async extractVideoCaption(videoMessage) {
    console.log("📝 Extracting video caption...");

    let caption = "";

    // First, check if the video message itself has text
    if (videoMessage.message && videoMessage.message.trim()) {
      caption = videoMessage.message.trim();
      console.log("✅ Found caption in video message");
      return caption;
    }

    // If no caption in video message, check surrounding messages
    try {
      const entity = await this.telegramClient.getEntity(this.groupName);

      // Get messages around the video message
      const surroundingMessages = await this.telegramClient.getMessages(
        entity,
        {
          ids: [videoMessage.id - 1, videoMessage.id, videoMessage.id + 1],
        }
      );

      // Check message before video
      const messageBefore = surroundingMessages.find(
        (m) => m.id === videoMessage.id - 1
      );
      if (
        messageBefore &&
        messageBefore.message &&
        messageBefore.message.trim()
      ) {
        // Check if it's from the same sender and within reasonable time
        const timeDiff = Math.abs(videoMessage.date - messageBefore.date);
        if (
          messageBefore.senderId === videoMessage.senderId &&
          timeDiff < 300
        ) {
          // 5 minutes
          caption = messageBefore.message.trim();
          console.log("✅ Found caption in message before video");
          return caption;
        }
      }

      // Check message after video
      const messageAfter = surroundingMessages.find(
        (m) => m.id === videoMessage.id + 1
      );
      if (messageAfter && messageAfter.message && messageAfter.message.trim()) {
        const timeDiff = Math.abs(messageAfter.date - videoMessage.date);
        if (messageAfter.senderId === videoMessage.senderId && timeDiff < 300) {
          // 5 minutes
          caption = messageAfter.message.trim();
          console.log("✅ Found caption in message after video");
          return caption;
        }
      }
    } catch (error) {
      console.log("⚠️  Could not fetch surrounding messages:", error.message);
    }

    console.log("ℹ️  No caption found for this video");
    return "";
  }

  async rewriteCaption(originalCaption) {
    if (!originalCaption || !originalCaption.trim()) {
      console.log("ℹ️  No caption to rewrite, using default");
      return "🎥 Interesting video content";
    }

    console.log("🤖 Rewriting caption with OpenAI...");

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: process.env.OPENAI_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `Rewrite this caption: "${originalCaption}"`,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      });

      const rewrittenCaption = response.choices[0].message.content.trim();
      console.log(`✅ Caption rewritten: "${rewrittenCaption}"`);
      return rewrittenCaption;
    } catch (error) {
      console.log("⚠️  OpenAI caption rewriting failed:", error.message);
      console.log("📝 Using original caption as fallback");
      return originalCaption;
    }
  }

  async downloadVideo(message) {
    console.log("⬇️  Downloading video...");

    const video = message.video;
    if (!video) {
      throw new Error("No video found in message");
    }

    // Check video size
    const videoSizeMB = video.size / (1024 * 1024);
    if (videoSizeMB > this.maxVideoSizeMB) {
      throw new Error(
        `Video too large: ${videoSizeMB.toFixed(2)}MB (max: ${
          this.maxVideoSizeMB
        }MB)`
      );
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `video_${message.id}_${timestamp}.mp4`;
    const filepath = path.join(this.downloadDir, filename);

    // Download with progress
    let lastProgress = 0;
    await this.telegramClient.downloadMedia(message, {
      outputFile: filepath,
      progressCallback: (downloaded, total) => {
        const progress = Math.round((downloaded / total) * 100);
        if (progress - lastProgress >= 10) {
          console.log(`📥 Download progress: ${progress}%`);
          lastProgress = progress;
        }
      },
    });

    console.log(
      `✅ Video downloaded: ${filename} (${videoSizeMB.toFixed(2)}MB)`
    );
    return filepath;
  }

  async uploadToTwitter(videoPath, caption) {
    console.log("🐦 Uploading to X (Twitter)...");

    try {
      // Read video file
      const videoBuffer = await fs.readFile(videoPath);

      // Upload media
      console.log("📤 Uploading media to X...");
      const mediaId = await this.twitterClient.v1.uploadMedia(videoBuffer, {
        mimeType: "video/mp4",
        target: "tweet",
      });

      // Prepare tweet text
      let tweetText = caption;
      if (tweetText.length > 280) {
        tweetText = tweetText.substring(0, 277) + "...";
      }

      if (!tweetText.trim()) {
        tweetText = "🎥 Video from Telegram"; // Default text if no caption
      }

      // Post tweet with video
      console.log("📝 Posting tweet...");
      const tweet = await this.twitterClient.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] },
      });

      console.log(`✅ Successfully posted to X! Tweet ID: ${tweet.data.id}`);
      return tweet;
    } catch (error) {
      console.error("❌ Error uploading to X:", error);
      throw error;
    }
  }

  async cleanup(videoPath) {
    try {
      if (await fs.pathExists(videoPath)) {
        await fs.remove(videoPath);
        console.log("🧹 Cleaned up downloaded video file");
      }
    } catch (error) {
      console.log("⚠️  Could not clean up video file:", error.message);
    }
  }

  async run() {
    try {
      await this.initialize();

      // Find oldest unprocessed video
      const videoMessage = await this.findOldestUnprocessedVideo();

      if (!videoMessage) {
        console.log("✅ No new videos to process. All caught up!");
        return;
      }

      // Extract original caption
      const originalCaption = await this.extractVideoCaption(videoMessage);
      console.log(`📝 Original caption: ${originalCaption || "(no caption)"}`);

      // Rewrite caption using OpenAI
      const rewrittenCaption = await this.rewriteCaption(originalCaption);
      console.log(`✨ Final caption: ${rewrittenCaption}`);

      // Download video
      const videoPath = await this.downloadVideo(videoMessage);

      // Upload to Twitter
      await this.uploadToTwitter(videoPath, rewrittenCaption);

      // Mark as processed (using improved ID generation)
      const videoId = this.generateVideoId(videoMessage);
      this.processedVideos.add(videoId);
      this.saveProcessedVideos();

      // Cleanup downloaded file
      await this.cleanup(videoPath);

      console.log("🎉 Successfully processed and posted video!");
    } catch (error) {
      console.error("❌ Error during execution:", error);
      process.exit(1);
    } finally {
      if (this.telegramClient) {
        await this.telegramClient.disconnect();
        console.log("👋 Disconnected from Telegram");
      }
    }
  }
}

// Run the application
const poster = new TelegramToXPoster();
poster.run().catch(console.error);
