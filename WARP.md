# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a Telegram Time Tracker Bot built with NestJS, TypeORM, and PostgreSQL (Neon). The bot allows users to track work hours through simple Telegram commands with automatic reporting and scheduled notifications. It's designed for deployment on cloud platforms like Railway, Render, or Vercel.

## Essential Development Commands

### Development Workflow
```bash
# Development with hot reload
npm run start:dev

# Build for production
npm run build

# Production mode
npm run start:prod

# Debug mode with debugging enabled
npm run start:debug
```

### Database Operations
```bash
# Generate a new migration based on entity changes
npm run migration:generate -- src/migrations/MigrationName

# Run pending migrations
npm run migration:run

# Direct TypeORM command access
npm run typeorm -- [command]
```

### Code Quality
```bash
# Lint and auto-fix TypeScript files
npm run lint

# Format code with Prettier
npm run format

# Run tests
npm run test
```

### Environment Setup
```bash
# Copy environment template for development
cp .env.example .env
# Then edit .env with your actual values
```

## Architecture Overview

### Core Architecture Pattern
The application follows NestJS modular architecture with dependency injection:

- **Entities**: TypeORM models representing database tables (User, TimeEntry, WorkSession)
- **Services**: Business logic layer with specialized responsibilities
- **Controllers**: HTTP endpoints for webhooks and health checks
- **Scheduled Tasks**: Automated reporting and reminder system

### Key Service Responsibilities

**TelegramService**: 
- Handles all Telegram bot commands (/checkin, /checkout, /status, /report)
- Manages webhook setup and message processing
- Acts as the main interface between users and the system

**TimeTrackingService**:
- Core check-in/check-out logic with timezone support
- Validates work sessions and prevents duplicate entries
- Manages WorkSession calculations and updates

**ReportService**:
- Generates daily, weekly, monthly, and custom range reports
- Formats time data with proper timezone handling
- Provides formatted output for both automated and manual reports

**SchedulerService**:
- Automated daily reports (9 PM), weekly reports (Friday 6 PM), monthly reports (last day 8 PM)
- Morning greetings (8 AM weekdays) and checkout reminders (7 PM for 8+ hour sessions)
- All schedules use Asia/Tehran timezone by default

**UserService**:
- User registration and management from Telegram data
- Timezone and preference handling

### Database Schema Design

**Users Table**: Stores Telegram user info with timezone preferences
**TimeEntries Table**: Individual check-in/check-out records with message tracking
**WorkSessions Table**: Daily aggregated work data with break tracking and completion status

The system uses a unique constraint on (telegramId, date) for WorkSessions to ensure one session per user per day.

### Environment Configuration

Required environment variables:
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `DATABASE_URL`: PostgreSQL connection string (Neon format)
- `TELEGRAM_WEBHOOK_URL`: Full webhook URL for production
- `NODE_ENV`: production/development
- `TIMEZONE`: Default timezone (Asia/Tehran)
- `PORT`: Application port (default 3000)

## Development Guidelines

### Working with Database Entities
- Always use the timezone-aware moment.js functions when handling timestamps
- Use `user.timezone` for all date/time calculations per user
- The system supports different timezones per user but defaults to Asia/Tehran

### Adding New Bot Commands
Add command handlers in `TelegramService.setupCommands()`:
```typescript
this.bot.command('newcommand', async (ctx) => {
  // Command implementation
});
```

### Working with Scheduled Tasks
Modify cron expressions in `SchedulerService`:
- Daily: `@Cron('0 21 * * *')` (9 PM)
- Weekly: `@Cron('0 18 * * 5')` (Friday 6 PM) 
- Monthly: `@Cron('0 20 L * *')` (Last day 8 PM)
- All use 'Asia/Tehran' timezone

### Database Migrations
- Always generate migrations when changing entities
- Test migrations on development before production
- Use TypeORM CLI commands through npm scripts
- Synchronize is disabled in production for safety

### Testing Bot Functionality
The bot requires:
1. Valid `TELEGRAM_BOT_TOKEN`
2. Running PostgreSQL database
3. Webhook URL configured (for production)

For development, you can test locally without webhooks using polling mode by not setting `TELEGRAM_WEBHOOK_URL`.

## Deployment Architecture

### Supported Platforms
- **Railway**: Primary recommendation with Dockerfile deployment
- **Render**: Alternative with build/start commands
- **Vercel**: Serverless deployment option

### Health Monitoring
- `GET /` - Basic status endpoint
- `GET /health` - Detailed health check with uptime
- Monitor logs for bot command errors and database connectivity

### Database Considerations
- Uses Neon PostgreSQL (free tier: 0.5GB storage)
- SSL required for connections
- Migrations run automatically in development, manually in production
- Connection pooling handled by TypeORM

## Common Development Patterns

### Error Handling
All services implement try-catch blocks with appropriate user-friendly error messages and logging.

### Time Zone Handling
Always use `moment.tz(timestamp, user.timezone)` for user-specific time calculations.

### Message Formatting
Bot responses use Markdown formatting with consistent emoji usage and structured layouts.

### Database Queries
Use TypeORM repository patterns with proper relation loading and timezone-aware date filtering.