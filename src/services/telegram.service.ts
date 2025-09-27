import { Context, Telegraf } from 'telegraf';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { ReportService } from './report.service';
import { TimeTrackingService } from './time-tracking.service';
import { UserService } from './user.service';

interface TelegramContext extends Context {
  match?: RegExpExecArray | null;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<TelegramContext>;

  constructor(
    private configService: ConfigService,
    private timeTrackingService: TimeTrackingService,
    private reportService: ReportService,
    private userService: UserService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    this.bot = new Telegraf<TelegramContext>(token);
    this.setupCommands();
  }

  async onModuleInit() {
    await this.setupWebhook();
    this.logger.log('Telegram bot initialized successfully');
  }

  private async setupWebhook() {
    const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
    if (webhookUrl) {
      await this.bot.telegram.setWebhook(webhookUrl);
      this.logger.log(`Webhook set to: ${webhookUrl}`);
    }
  }

  private setupCommands() {
    // Start command
    this.bot.start(async (ctx) => {
      await this.userService.createOrUpdateUser(ctx.from);
      const welcomeMessage = `
🎯 **Welcome to Time Tracker Bot!**

Available commands:
📍 /checkin - Record your arrival time
📤 /checkout - Record your departure time
📊 /status - View today's work status
📈 /report daily - Today's work summary
📈 /report weekly - This week's summary
📈 /report monthly - This month's summary
📈 /report range YYYY-MM-DD YYYY-MM-DD - Custom date range
⚙️ /settings - Configure your preferences
❓ /help - Show this help message

Let's start tracking your work hours! 🚀
      `;
      await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
    });

    // Check-in command
    this.bot.command('checkin', async (ctx) => {
      try {
        const user = ctx.from;
        await this.userService.createOrUpdateUser(user);

        const result = await this.timeTrackingService.checkIn(
          user.id.toString(),
          new Date(),
          ctx.message.message_id.toString(),
        );

        if (result.success) {
          await ctx.reply(
            `✅ **Checked in successfully!**\n\n` +
            `🕐 Time: ${result.formattedTime}\n` +
            `📅 Date: ${result.date}\n\n` +
            `Have a productive day! 💪`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ ${result.message}`, { parse_mode: 'Markdown' });
        }
      } catch (error) {
        this.logger.error('Check-in error:', error);
        await ctx.reply('❌ An error occurred during check-in. Please try again.');
      }
    });

    // Check-out command
    this.bot.command('checkout', async (ctx) => {
      try {
        const user = ctx.from;
        const result = await this.timeTrackingService.checkOut(
          user.id.toString(),
          new Date(),
          ctx.message.message_id.toString(),
        );

        if (result.success) {
          await ctx.reply(
            `✅ **Checked out successfully!**\n\n` +
            `🕐 Time: ${result.formattedTime}\n` +
            `📅 Date: ${result.date}\n` +
            `⏱️ Total hours today: ${result.totalHours}\n\n` +
            `Great work today! 🎉`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ ${result.message}`, { parse_mode: 'Markdown' });
        }
      } catch (error) {
        this.logger.error('Check-out error:', error);
        await ctx.reply('❌ An error occurred during check-out. Please try again.');
      }
    });

    // Status command
    this.bot.command('status', async (ctx) => {
      try {
        const status = await this.timeTrackingService.getTodayStatus(
          ctx.from.id.toString(),
        );
        await ctx.reply(status, { parse_mode: 'Markdown' });
      } catch (error) {
        this.logger.error('Status error:', error);
        await ctx.reply('❌ An error occurred while fetching status.');
      }
    });

    // Report command with different types
    this.bot.hears(/^\/report\s+(\w+)(.*)/, async (ctx) => {
      try {
        const match = ctx.match;
        const reportType = match[1];
        const params = match[2]?.trim();

        let report: string;
        const userId = ctx.from.id.toString();

        switch (reportType.toLowerCase()) {
          case 'daily':
            report = await this.reportService.getDailyReport(userId);
            break;
          case 'weekly':
            report = await this.reportService.getWeeklyReport(userId);
            break;
          case 'monthly':
            report = await this.reportService.getMonthlyReport(userId);
            break;
          case 'range':
            const dates = params?.split(' ').filter(d => d);
            if (!dates || dates.length !== 2) {
              await ctx.reply('❌ Please provide start and end dates in format: /report range YYYY-MM-DD YYYY-MM-DD');
              return;
            }
            report = await this.reportService.getRangeReport(userId, dates[0], dates[1]);
            break;
          default:
            await ctx.reply('❌ Invalid report type. Use: daily, weekly, monthly, or range');
            return;
        }

        await ctx.reply(report, { parse_mode: 'Markdown' });
      } catch (error) {
        this.logger.error('Report error:', error);
        await ctx.reply('❌ An error occurred while generating the report.');
      }
    });

    // Help command
    this.bot.help(async (ctx) => {
      const helpMessage = `
🎯 **Time Tracker Bot - Help**

**Basic Commands:**
📍 /checkin - Record your arrival time
📤 /checkout - Record your departure time
📊 /status - View today's work status

**Reports:**
📈 /report daily - Today's work summary
📈 /report weekly - This week's summary
📈 /report monthly - This month's summary
📈 /report range 2024-01-01 2024-01-31 - Custom date range

**Other Commands:**
⚙️ /settings - Configure timezone and preferences
❓ /help - Show this help message

**Tips:**
• You can add notes with check-in: /checkin Working on project X
• The bot automatically calculates your work hours
• All times are adjusted to your configured timezone
• You can check your status anytime during the day

Need more help? Contact your admin! 👨‍💻
      `;
      await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    });

    // Error handling
    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for ${ctx.updateType}:`, err);
      ctx.reply('❌ Something went wrong. Please try again later.');
    });
  }

  getBotInstance() {
    return this.bot;
  }

  async handleUpdate(update: any) {
    return this.bot.handleUpdate(update);
  }
}