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
    this.failedVideosFile = "./failed_videos.json";

    // Initialize Telegram client
    this.telegramClient = null;
    this.processedVideos = this.loadProcessedVideos();
    this.failedVideos = this.loadFailedVideos();
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

  loadFailedVideos() {
    try {
      if (fs.existsSync(this.failedVideosFile)) {
        const data = fs.readFileSync(this.failedVideosFile, "utf8");
        const failedData = JSON.parse(data);

        // Handle both old format (array) and new format (object with metadata)
        if (Array.isArray(failedData)) {
          const videoSet = new Set(failedData);
          console.log(
            `📂 Loaded ${videoSet.size} failed videos (legacy format)`
          );
          return videoSet;
        } else {
          const videoSet = new Set(failedData.videos || []);
          console.log(`📂 Loaded ${videoSet.size} failed videos`);
          return videoSet;
        }
      }
    } catch (error) {
      console.log("⚠️  Could not load failed videos list, starting fresh");
    }
    return new Set();
  }

  saveFailedVideos() {
    try {
      const dataToSave = {
        lastUpdated: new Date().toISOString(),
        totalFailed: this.failedVideos.size,
        videos: [...this.failedVideos],
      };

      fs.writeFileSync(
        this.failedVideosFile,
        JSON.stringify(dataToSave, null, 2)
      );
      console.log(`💾 Saved ${this.failedVideos.size} failed video records`);
    } catch (error) {
      console.error("❌ Error saving failed videos list:", error);
    }
  }

  addFailedVideo(videoId, reason, error = null) {
    const failureRecord = {
      videoId,
      reason,
      timestamp: new Date().toISOString(),
      error: error ? error.message : null,
    };

    this.failedVideos.add(JSON.stringify(failureRecord));
    this.saveFailedVideos();
    console.log(`❌ Marked video as failed: ${reason}`);
  }

  isVideoFailed(videoId) {
    // Check if any failed video record contains this videoId
    for (const failedRecord of this.failedVideos) {
      try {
        const record = JSON.parse(failedRecord);
        if (record.videoId === videoId) {
          return true;
        }
      } catch (error) {
        // Handle legacy format where failed videos were just IDs
        if (failedRecord === videoId) {
          return true;
        }
      }
    }
    return false;
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

        // Check if this video has been processed or failed
        if (
          !this.processedVideos.has(videoId) &&
          !this.isVideoFailed(videoId)
        ) {
          console.log(
            `🎯 Found oldest unprocessed video: Message ID ${
              message.id
            } (batch ${Math.ceil(currentBatch / batchSize)})`
          );
          return message;
        }

        // Skip if already processed or failed
        if (this.processedVideos.has(videoId)) {
          console.log(
            `⏭️  Skipping already processed video: Message ID ${message.id}`
          );
        } else if (this.isVideoFailed(videoId)) {
          console.log(
            `⏭️  Skipping previously failed video: Message ID ${message.id}`
          );
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
    console.log("📝 Extracting video caption with AI assistance...");

    // First, check if the video message itself has text
    if (videoMessage.message && videoMessage.message.trim()) {
      const caption = videoMessage.message.trim();
      console.log("✅ Found caption in video message");
      return caption;
    }

    // Get surrounding messages (-2 to +2) for AI analysis
    try {
      const entity = await this.telegramClient.getEntity(this.groupName);

      // Get a wider range of messages around the video
      const messageIds = [
        videoMessage.id - 2,
        videoMessage.id - 1,
        videoMessage.id,
        videoMessage.id + 1,
        videoMessage.id + 2,
      ];

      console.log("🔍 Fetching surrounding messages for context analysis...");
      const surroundingMessages = await this.telegramClient.getMessages(
        entity,
        {
          ids: messageIds,
        }
      );

      // Filter out the video message itself and empty messages
      const contextMessages = surroundingMessages
        .filter(
          (msg) =>
            msg &&
            msg.id !== videoMessage.id &&
            msg.message &&
            msg.message.trim()
        )
        .map((msg) => ({
          id: msg.id,
          text: msg.message.trim(),
          senderId: msg.senderId,
          date: msg.date,
          position: msg.id < videoMessage.id ? "before" : "after",
          timeDiff: Math.abs(videoMessage.date - msg.date),
        }))
        .sort((a, b) => a.id - b.id); // Sort by message order

      if (contextMessages.length === 0) {
        console.log("ℹ️  No surrounding messages found");
        return "";
      }

      console.log(
        `🔍 Found ${contextMessages.length} surrounding messages, analyzing relevance...`
      );

      // Use AI to determine which message is most relevant as a caption
      const relevantCaption = await this.findRelevantCaption(
        videoMessage,
        contextMessages
      );

      if (relevantCaption) {
        console.log(`✅ AI found relevant caption: "${relevantCaption}"`);
        return relevantCaption;
      }

      console.log("ℹ️  No relevant caption found by AI analysis");
      return "";
    } catch (error) {
      console.log("⚠️  Could not fetch surrounding messages:", error.message);
      return "";
    }
  }

  async findRelevantCaption(videoMessage, contextMessages) {
    if (contextMessages.length === 0) return "";

    try {
      // Prepare context for AI analysis
      const messageContext = contextMessages
        .map(
          (msg) =>
            `Message ${msg.id} (${msg.position} video, ${msg.timeDiff}s apart): "${msg.text}"`
        )
        .join("\n");

      const prompt = `I have a video message and several surrounding text messages. Help me identify which message, if any, would be the best caption for this video.

Video Message ID: ${videoMessage.id}
Video Date: ${new Date(videoMessage.date * 1000).toISOString()}

Surrounding Messages:
${messageContext}

Please analyze these messages and determine:
1. Which message (if any) is most likely to be a caption for the video
2. Consider factors like: timing proximity, sender relationship, content relevance, typical social media posting patterns

Respond with ONLY the exact text of the most relevant message, or NONE if no message seems relevant as a caption.
Do not add any explanation, formatting, or quotation marks - just the raw message text or NONE.`;

      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert at analyzing social media message patterns to identify captions for videos. You understand timing, context, and typical posting behaviors.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.3, // Lower temperature for more consistent analysis
      });

      let aiResponse = response.choices[0].message.content.trim();

      // Clean up the AI response - remove surrounding quotes if present
      if (
        (aiResponse.startsWith('"') && aiResponse.endsWith('"')) ||
        (aiResponse.startsWith("'") && aiResponse.endsWith("'"))
      ) {
        aiResponse = aiResponse.slice(1, -1).trim();
      }

      if (aiResponse === "NONE" || !aiResponse) {
        return "";
      }

      // Verify the AI response matches one of our context messages
      const matchingMessage = contextMessages.find(
        (msg) =>
          msg.text === aiResponse ||
          msg.text.includes(aiResponse) ||
          aiResponse.includes(msg.text)
      );

      if (matchingMessage) {
        console.log(
          `🤖 AI selected message ${matchingMessage.id} (${matchingMessage.position} video)`
        );
        return aiResponse;
      } else {
        console.log(
          "⚠️  AI response didn't match any context message, using fallback"
        );
        // Fallback to simple logic for same sender within 5 minutes
        const fallbackMessage = contextMessages.find(
          (msg) => msg.senderId === videoMessage.senderId && msg.timeDiff < 300
        );
        return fallbackMessage ? fallbackMessage.text : "";
      }
    } catch (error) {
      console.log("⚠️  AI caption analysis failed:", error.message);

      // Fallback to simple logic
      console.log("🔄 Using fallback logic...");
      const fallbackMessage = contextMessages.find(
        (msg) => msg.senderId === videoMessage.senderId && msg.timeDiff < 300
      );
      return fallbackMessage ? fallbackMessage.text : "";
    }
  }

  async rewriteCaption(originalCaption) {
    // Ensure we have a valid string to work with
    const cleanCaption =
      originalCaption && typeof originalCaption === "string"
        ? originalCaption.trim()
        : "";

    if (!cleanCaption) {
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
            content:
              process.env.OPENAI_SYSTEM_PROMPT ||
              "You are a social media content creator. Rewrite the given caption to make it more engaging for Twitter/X while keeping the same meaning. Make it concise (under 250 characters), engaging, and suitable for a general audience. Don't use hashtags unless they were in the original. Keep the tone similar to the original but make it more polished.",
          },
          {
            role: "user",
            content: `Rewrite this caption: ${cleanCaption}`,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      });

      let rewrittenCaption = response.choices[0].message.content.trim();

      // Clean up the AI response - remove surrounding quotes if present
      if (
        (rewrittenCaption.startsWith('"') && rewrittenCaption.endsWith('"')) ||
        (rewrittenCaption.startsWith("'") && rewrittenCaption.endsWith("'"))
      ) {
        rewrittenCaption = rewrittenCaption.slice(1, -1).trim();
      }

      console.log(`✅ Caption rewritten: ${rewrittenCaption}`);
      return rewrittenCaption;
    } catch (error) {
      console.log("⚠️  OpenAI caption rewriting failed:", error.message);
      console.log("📝 Using original caption as fallback");
      return cleanCaption || "🎥 Video from Telegram";
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
    const maxVideosPerRun = 1; // Process only 1 video per run (perfect for daily cron jobs)
    let processedCount = 0;
    let failedCount = 0;

    try {
      await this.initialize();

      console.log("🚀 Starting daily video processing (1 video per run)");

      while (processedCount + failedCount < maxVideosPerRun) {
        let videoPath = null;
        let videoMessage = null;

        try {
          // Find oldest unprocessed video
          videoMessage = await this.findOldestUnprocessedVideo();

          if (!videoMessage) {
            console.log("✅ No more videos to process. All caught up!");
            break;
          }

          const videoId = this.generateVideoId(videoMessage);
          console.log(`🎬 Processing video: Message ID ${videoMessage.id}`);

          // Extract original caption
          const originalCaption = await this.extractVideoCaption(videoMessage);
          console.log(
            `📝 Original caption: ${originalCaption || "(no caption)"}`
          );

          // Rewrite caption using OpenAI
          const rewrittenCaption = await this.rewriteCaption(originalCaption);
          console.log(`✨ Final caption: ${rewrittenCaption}`);

          // Download video
          videoPath = await this.downloadVideo(videoMessage);

          // Upload to Twitter - this is where most failures occur
          await this.uploadToTwitter(videoPath, rewrittenCaption);

          // Mark as processed (using improved ID generation)
          this.processedVideos.add(videoId);
          this.saveProcessedVideos();

          processedCount++;
          console.log("🎉 Successfully processed and posted video!");
        } catch (uploadError) {
          // Handle specific upload failures
          console.error(
            `❌ Failed to process video ${videoMessage?.id}:`,
            uploadError.message
          );

          if (videoMessage) {
            const videoId = this.generateVideoId(videoMessage);

            // Determine failure reason based on error
            let failureReason = "Unknown upload error";

            if (uploadError.message.includes("video longer than")) {
              failureReason = "Video too long (>2 minutes)";
            } else if (
              uploadError.message.includes("Forbidden") ||
              uploadError.code === 403
            ) {
              failureReason = "Twitter API forbidden (video restrictions)";
            } else if (
              uploadError.message.includes("too large") ||
              uploadError.message.includes("file size")
            ) {
              failureReason = "Video file too large";
            } else if (
              uploadError.message.includes("format") ||
              uploadError.message.includes("codec")
            ) {
              failureReason = "Unsupported video format";
            } else if (uploadError.code === 429) {
              failureReason = "Rate limit exceeded";
            } else if (uploadError.code >= 400 && uploadError.code < 500) {
              failureReason = `Client error: ${uploadError.code}`;
            } else if (uploadError.code >= 500) {
              failureReason = `Server error: ${uploadError.code}`;
            }

            // Add to failed videos list
            this.addFailedVideo(videoId, failureReason, uploadError);
            failedCount++;

            console.log(
              "⏭️  Video marked as failed and will be skipped in future runs"
            );
          }
        } finally {
          // Always cleanup downloaded file for this video
          if (videoPath) {
            await this.cleanup(videoPath);
          }
        }

        // No delay needed since we only process 1 video per run
      }

      // Summary
      if (processedCount > 0) {
        console.log("📊 Run completed successfully - 1 video posted!");
      } else if (failedCount > 0) {
        console.log(
          "📊 Run completed - 1 video failed and marked for skipping"
        );
      }
    } catch (error) {
      console.error("❌ Critical error during execution:", error);
      process.exit(1);
    } finally {
      // Disconnect from Telegram
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
