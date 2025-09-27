# 🤖 Telegram Time Tracker Bot

A powerful NestJS-based Telegram bot for tracking work hours with automatic reporting and Neon PostgreSQL integration.

## ✨ Features

- 📍 **Check-in/Check-out**: Simple commands to track work time
- 📊 **Smart Reports**: Daily, weekly, monthly, and custom range reports
- ⏰ **Scheduled Messages**: Automatic daily reports and reminders
- 🌍 **Timezone Support**: Works with your local timezone
- 🔄 **Real-time Status**: Check your current work status anytime
- 🎯 **Channel Support**: Works in Telegram channels with topics
- 📈 **Analytics**: Track productivity patterns and work efficiency

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Telegram Bot Token (from @BotFather)
- Neon PostgreSQL database (free tier)
- Cloud hosting platform (Railway/Render/Vercel)

### 1. Get Your Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Choose a name and username for your bot
4. Copy the bot token (keep it secret!)

### 2. Setup Neon Database

1. Go to [Neon Console](https://console.neon.tech/)
2. Create a new project (free tier gives you 0.5GB storage)
3. Copy the connection string from the dashboard
4. It should look like: `postgres://username:password@ep-xxx-xxx.us-east-1.aws.neon.tech/database-name?sslmode=require`

### 3. Deploy to Railway (Recommended - Free)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-link)

**Manual Railway Deployment:**

1. Fork this repository to your GitHub
2. Go to [Railway](https://railway.app) and sign up
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your forked repository
5. Add these environment variables:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   DATABASE_URL=your_neon_connection_string
   TELEGRAM_WEBHOOK_URL=https://your-app-name.up.railway.app/telegram/webhook
   NODE_ENV=production
   TIMEZONE=Asia/Tehran
   ```
6. Deploy and wait for build to complete
7. Your bot is now live! 🎉

### 4. Alternative Deployment Options

#### Render (Free Tier)
1. Go to [Render](https://render.com) and connect your GitHub
2. Create a new Web Service
3. Select your repository 
4. Set build command: `npm install && npm run build`
5. Set start command: `npm run start:prod`
6. Add the same environment variables as above
7. Update `TELEGRAM_WEBHOOK_URL` to your Render URL

#### Vercel (Serverless)
```bash
npm i -g vercel
vercel --prod
```
Add environment variables in Vercel dashboard.

## 🛠️ Local Development

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd telegram-timetrack-bot

# Install dependencies  
npm install

# Copy environment file
cp .env.example .env
```

### Configure Environment
Edit `.env` file:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
DATABASE_URL=your_neon_db_url
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
NODE_ENV=development
PORT=3000
TIMEZONE=Asia/Tehran
```

### Run Development Server
```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run start:prod

# Debug mode
npm run start:debug
```

### Database Operations
```bash
# Generate migration
npm run migration:generate -- src/migrations/InitialMigration

# Run migrations
npm run migration:run
```

## 📱 Bot Commands

### Basic Commands
- `/start` - Initialize the bot and register user
- `/checkin` - Record your arrival time
- `/checkout` - Record your departure time
- `/status` - View today's work status
- `/help` - Show help message

### Report Commands
- `/report daily` - Today's work summary
- `/report weekly` - This week's summary
- `/report monthly` - This month's summary
- `/report range 2024-01-01 2024-01-31` - Custom date range

### Examples
```
/checkin - Simple check-in
/checkout - Simple check-out
/report daily - Get today's report
/report range 2024-01-01 2024-01-31 - Custom range report
```

## ⏰ Scheduled Features

The bot automatically sends:
- **Daily Reports** (9 PM): Summary of the day's work
- **Weekly Reports** (Friday 6 PM): Full week analysis
- **Monthly Reports** (Last day of month 8 PM): Complete month statistics
- **Morning Greetings** (8 AM weekdays): Work tracking reminders
- **Checkout Reminders** (7 PM): For users working >8 hours

## 🏗️ Architecture

### Tech Stack
- **Backend**: NestJS + TypeScript
- **Database**: PostgreSQL (Neon)
- **ORM**: TypeORM
- **Bot Framework**: Telegraf
- **Scheduling**: @nestjs/schedule
- **Hosting**: Railway/Render/Vercel

### Project Structure
```
src/
├── config/           # Database and app configuration
├── controllers/      # API endpoints (webhook)
├── entities/         # Database models
├── services/         # Business logic
│   ├── telegram.service.ts     # Bot commands and handlers
│   ├── time-tracking.service.ts # Check-in/out logic
│   ├── report.service.ts       # Report generation
│   ├── user.service.ts         # User management
│   └── scheduler.service.ts    # Automated tasks
├── app.module.ts     # Main application module
└── main.ts          # Application entry point
```

### Database Schema
- **Users**: Telegram user information and settings
- **TimeEntries**: Individual check-in/check-out records
- **WorkSessions**: Calculated daily work summaries

## 🔒 Security & Privacy

- All data is stored securely in Neon PostgreSQL
- Bot token is kept in environment variables
- SSL/TLS encryption for all communications
- No sensitive data logged
- GDPR compliant (users can request data deletion)

## 🌍 Internationalization

Currently supports:
- English interface
- Persian/Farsi timezone (Asia/Tehran)
- Customizable timezone per user

To add more languages, modify the message strings in `telegram.service.ts`.

## 🛠️ Customization

### Change Timezone
Update `TIMEZONE` environment variable or modify default in `user.entity.ts`:
```typescript
@Column({ default: 'YOUR_TIMEZONE' })
timezone: string;
```

### Modify Schedule Times
Edit cron expressions in `scheduler.service.ts`:
```typescript
@Cron('0 21 * * *') // 9 PM daily
@Cron('0 18 * * 5') // 6 PM Fridays  
@Cron('0 20 L * *') // 8 PM last day of month
```

### Add New Commands
Add command handlers in `telegram.service.ts`:
```typescript
this.bot.command('newcommand', async (ctx) => {
  // Your command logic
});
```

## 🚨 Troubleshooting

### Common Issues

**Bot not responding:**
- Check if webhook URL is correctly set
- Verify bot token is valid
- Check Railway/Render logs for errors

**Database connection failed:**
- Verify Neon connection string is correct
- Ensure SSL is enabled
- Check if database is sleeping (Neon free tier)

**Scheduled tasks not working:**
- Confirm timezone settings
- Check server time vs expected time
- Verify cron expressions are correct

**Reports showing wrong data:**
- Check timezone configuration
- Verify database entries are correct
- Ensure date calculations are in user's timezone

### Debug Commands
```bash
# Check logs
npm run start:dev

# Test database connection
npx typeorm query "SELECT NOW()" -d src/config/typeorm.config.ts

# Validate environment
node -e "console.log(process.env)"
```

## 📊 Monitoring

### Health Checks
- `GET /` - Basic status
- `GET /health` - Detailed health check with uptime

### Logs
Monitor application logs through your hosting platform:
- Railway: Check deployment logs
- Render: View service logs  
- Vercel: Check function logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 **Email**: your-email@example.com
- 💬 **Telegram**: [@your_username](https://t.me/your_username)
- 🐛 **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- 📖 **Documentation**: [Wiki](https://github.com/your-repo/wiki)

---

### 🌟 Made with ❤️ using NestJS and Neon PostgreSQL

**Free Tier Limitations:**
- Railway: 512MB RAM, $5 credit/month
- Neon: 0.5GB storage, 10GB transfer
- Render: 512MB RAM, 400 build minutes/month

This should be sufficient for personal use or small teams (up to 50 users).