# Telegram to X (Twitter) Video Poster

Automatically fetch the oldest unprocessed videos from Telegram groups/channels and post them to your X (Twitter) account with captions.

## Features

- 🎥 Fetches oldest unprocessed videos from Telegram groups/channels
- 📝 Intelligently extracts captions from video messages or surrounding messages
- ⬇️ Downloads videos with progress tracking
- 🐦 Uploads videos to X (Twitter) with captions
- 💾 Persistent session management (no repeated logins)
- 📊 Tracks processed videos to avoid duplicates
- 🧹 Automatic cleanup of downloaded files
- ⚙️ Configurable file size limits and download directory

## Prerequisites

1. **Telegram API Credentials**

   - Go to [my.telegram.org](https://my.telegram.org)
   - Create an application to get `api_id` and `api_hash`

2. **X (Twitter) API Credentials**

   - Go to [developer.twitter.com](https://developer.twitter.com)
   - Create an app to get API keys and access tokens
   - You need: API Key, API Secret, Access Token, Access Token Secret

3. **Node.js** (version 16 or higher)

## Installation

1. Clone or download this project
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your environment file:

   ```bash
   cp env.example .env
   ```

4. Edit `.env` with your credentials:

   ```env
   # Telegram API credentials
   TELEGRAM_API_ID=your_api_id_here
   TELEGRAM_API_HASH=your_api_hash_here

   # Twitter/X API credentials
   TWITTER_API_KEY=your_api_key_here
   TWITTER_API_SECRET=your_api_secret_here
   TWITTER_ACCESS_TOKEN=your_access_token_here
   TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret_here

   # Telegram group/channel to fetch videos from
   TELEGRAM_GROUP=@your_group_or_channel_name

   # Optional settings
   DOWNLOAD_DIR=./downloads
   MAX_VIDEO_SIZE_MB=50
   ```

## Usage

### First Run

On your first run, you'll need to authenticate with Telegram:

```bash
npm start
```

The script will prompt you for:

- Your phone number (with country code, e.g., +1234567890)
- Verification code sent to your phone
- 2FA password (if enabled)

Your session will be saved for future runs.

### Daily Automation

Set up a cron job to run the script daily:

```bash
# Edit your crontab
crontab -e

# Add this line to run daily at 2 AM
0 2 * * * cd /path/to/your/project && npm start
```

Or use a scheduler like PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

## How It Works

### Video Fetching Logic

The script uses an **efficient pagination system** to handle large groups:

1. **Smart Batching**: Processes videos in small batches (50 at a time) instead of loading thousands
2. **Offset Tracking**: Remembers where it left off using `video_offset.json`
3. **Reverse Order**: Starts from the oldest messages (`reverse: true`)
4. **Automatic Progression**: When a batch is fully processed, automatically moves to the next batch
5. **Memory Efficient**: Never loads more than 50 videos into memory at once

**Example for 9000 videos:**

- Day 1: Processes videos 1-50 (finds oldest unprocessed)
- Day 2: Continues from video 51-100
- Day 3: Continues from video 101-150
- And so on...

### AI-Enhanced Caption Extraction Logic

The script uses **advanced AI analysis** to find the most relevant captions:

1. **Direct Caption**: First checks if the video message itself contains text
2. **Context Gathering**: Fetches 5 surrounding messages (-2 to +2 from the video)
3. **AI Analysis**: Uses OpenAI to analyze all context messages and determine relevance
4. **Smart Selection**: AI considers:
   - Timing proximity to the video
   - Sender relationships
   - Content relevance to video context
   - Typical social media posting patterns
5. **Fallback Logic**: If AI fails, uses traditional logic (same sender, within 5 minutes)

**Example AI Analysis:**

```
Message 136 (before video, 30s apart): "Wait for it..."
Message 137 (before video, 10s apart): "This is hilarious 😂"
[VIDEO MESSAGE 138]
Message 139 (after video, 5s apart): "LMAO did you see that?"
Message 140 (after video, 45s apart): "Totally unrelated topic"

AI Result: Selects "This is hilarious 😂" as most relevant caption
```

This approach handles complex posting patterns that simple logic would miss!

### File Management

- Downloads videos to `./downloads/` (configurable)
- Uses timestamps and message IDs for unique filenames
- Automatically cleans up downloaded files after posting
- Respects file size limits (default 50MB)

## Configuration Options

| Variable            | Description                       | Default       |
| ------------------- | --------------------------------- | ------------- |
| `TELEGRAM_GROUP`    | Group/channel username or ID      | Required      |
| `DOWNLOAD_DIR`      | Directory for temporary downloads | `./downloads` |
| `MAX_VIDEO_SIZE_MB` | Maximum video file size in MB     | `50`          |

## Files Created

- `telegram_session.txt` - Stores your Telegram session (keep secure!)
- `processed_videos.json` - Tracks which videos have been successfully posted
- `failed_videos.json` - Tracks videos that failed to upload (with reasons)
- `video_offset.json` - Tracks current position in the video list for pagination
- `downloads/` - Temporary directory for video files (auto-cleaned)

## Error Handling

The script includes **intelligent error handling** that gracefully handles failures:

### **Upload Failure Handling**

- **Automatic Skip**: Failed videos are logged and skipped permanently
- **Detailed Logging**: Records failure reason and timestamp in `failed_videos.json`
- **Continue Processing**: Script continues with next video instead of crashing
- **Smart Detection**: Identifies specific failure types:
  - Videos longer than 2 minutes
  - File size restrictions
  - Format/codec issues
  - Rate limiting
  - API permission errors

### **Common Error Types**

- Network connectivity issues
- API rate limits (429 errors)
- File I/O errors
- Authentication problems
- Video size/duration limits
- Unsupported video formats
- Missing captions

### **Failed Video Tracking**

Example `failed_videos.json`:

```json
{
  "lastUpdated": "2024-01-15T10:30:00Z",
  "totalFailed": 3,
  "videos": [
    "{\"videoId\":\"123_456_789\",\"reason\":\"Video too long (>2 minutes)\",\"timestamp\":\"2024-01-15T10:30:00Z\"}"
  ]
}
```

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- The `telegram_session.txt` file contains sensitive session data
- Consider using environment variables in production instead of `.env` files

## Troubleshooting

### Common Issues

1. **"No videos found"**

   - Check that the group/channel name is correct
   - Ensure the bot has access to the group
   - Verify there are actually video messages in the group

2. **"Authentication failed"**

   - Double-check your API credentials
   - Ensure your phone number includes the country code
   - Try deleting `telegram_session.txt` and re-authenticating

3. **"Video too large"**

   - Increase `MAX_VIDEO_SIZE_MB` in your `.env` file
   - Or skip large videos by keeping the default limit

4. **Twitter upload fails**
   - Verify your Twitter API credentials have write permissions
   - Check that your app has the necessary permissions
   - Ensure the video format is supported (MP4 works best)

### Logs

The script provides detailed logging for each step:

- 🚀 Initialization
- 📱 Telegram authentication
- 🔍 Video searching
- 📝 Caption extraction
- ⬇️ Download progress
- 🐦 Twitter upload
- ✅ Success confirmation

## License

MIT License - feel free to modify and use as needed!
