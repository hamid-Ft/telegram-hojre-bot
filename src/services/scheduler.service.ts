import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service';
import { ReportService } from './report.service';
import { TelegramService } from './telegram.service';
import * as moment from 'moment-timezone';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private userService: UserService,
    private reportService: ReportService,
    private telegramService: TelegramService,
    private configService: ConfigService,
  ) {}

  // Daily report at 9 PM (21:00)
  @Cron('0 21 * * *', {
    name: 'daily-reports',
    timeZone: 'Asia/Tehran', // Adjust to your timezone
  })
  async sendDailyReports() {
    this.logger.log('Starting daily report generation...');

    try {
      const activeUsers = await this.userService.getAllActiveUsers();
      
      for (const user of activeUsers) {
        try {
          const report = await this.reportService.getDailyReport(user.telegramId);
          
          // Only send if user has activity today
          if (!report.includes('No activity recorded')) {
            await this.sendMessageToUser(
              user.telegramId,
              `🌙 **Daily Summary**\n\n${report}\n\n_Sent automatically at 9 PM_`
            );
          }
        } catch (error) {
          this.logger.error(`Failed to send daily report to user ${user.telegramId}:`, error);
        }
      }

      this.logger.log(`Daily reports sent to ${activeUsers.length} users`);
    } catch (error) {
      this.logger.error('Failed to send daily reports:', error);
    }
  }

  // Weekly report on Fridays at 6 PM (18:00)
  @Cron('0 18 * * 5', {
    name: 'weekly-reports',
    timeZone: 'Asia/Tehran',
  })
  async sendWeeklyReports() {
    this.logger.log('Starting weekly report generation...');

    try {
      const activeUsers = await this.userService.getAllActiveUsers();
      
      for (const user of activeUsers) {
        try {
          const report = await this.reportService.getWeeklyReport(user.telegramId);
          
          await this.sendMessageToUser(
            user.telegramId,
            `📅 **Weekly Summary**\n\n${report}\n\n_Sent automatically every Friday at 6 PM_`
          );
        } catch (error) {
          this.logger.error(`Failed to send weekly report to user ${user.telegramId}:`, error);
        }
      }

      this.logger.log(`Weekly reports sent to ${activeUsers.length} users`);
    } catch (error) {
      this.logger.error('Failed to send weekly reports:', error);
    }
  }

  // Monthly report on the last day of each month at 8 PM (20:00)
  @Cron('0 20 L * *', {
    name: 'monthly-reports',
    timeZone: 'Asia/Tehran',
  })
  async sendMonthlyReports() {
    this.logger.log('Starting monthly report generation...');

    try {
      const activeUsers = await this.userService.getAllActiveUsers();
      
      for (const user of activeUsers) {
        try {
          const report = await this.reportService.getMonthlyReport(user.telegramId);
          
          await this.sendMessageToUser(
            user.telegramId,
            `📊 **Monthly Summary**\n\n${report}\n\n_Sent automatically on the last day of each month_`
          );
        } catch (error) {
          this.logger.error(`Failed to send monthly report to user ${user.telegramId}:`, error);
        }
      }

      this.logger.log(`Monthly reports sent to ${activeUsers.length} users`);
    } catch (error) {
      this.logger.error('Failed to send monthly reports:', error);
    }
  }

  // Reminder for users who forgot to check out (every day at 7 PM)
  @Cron('0 19 * * *', {
    name: 'checkout-reminders',
    timeZone: 'Asia/Tehran',
  })
  async sendCheckoutReminders() {
    this.logger.log('Checking for users who forgot to check out...');

    try {
      const activeUsers = await this.userService.getAllActiveUsers();
      
      for (const user of activeUsers) {
        try {
          // Check if user is currently checked in but hasn't checked out
          const today = moment.tz(user.timezone).format('YYYY-MM-DD');
          const statusMessage = await this.reportService.getDailyReport(user.telegramId, today);
          
          // Simple check for incomplete sessions
          if (statusMessage.includes('Currently working for:')) {
            const workingHours = this.extractWorkingHours(statusMessage);
            
            // Send reminder if working more than 8 hours
            if (workingHours > 8) {
              await this.sendMessageToUser(
                user.telegramId,
                `⏰ **Checkout Reminder**\n\n` +
                `You've been working for ${workingHours.toFixed(1)} hours today!\n\n` +
                `Don't forget to /checkout when you finish work. 😊\n\n` +
                `_This is an automatic reminder sent at 7 PM_`
              );
            }
          }
        } catch (error) {
          this.logger.error(`Failed to check checkout reminder for user ${user.telegramId}:`, error);
        }
      }

      this.logger.log('Checkout reminders processed');
    } catch (error) {
      this.logger.error('Failed to process checkout reminders:', error);
    }
  }

  // Good morning message with work tracking encouragement (8 AM on weekdays)
  @Cron('0 8 * * 1-5', {
    name: 'morning-greetings',
    timeZone: 'Asia/Tehran',
  })
  async sendMorningGreetings() {
    this.logger.log('Sending morning greetings...');

    try {
      const activeUsers = await this.userService.getAllActiveUsers();
      
      for (const user of activeUsers) {
        try {
          const today = moment.tz(user.timezone).format('dddd');
          
          await this.sendMessageToUser(
            user.telegramId,
            `🌅 **Good Morning!**\n\n` +
            `Happy ${today}! Ready to start tracking your work time?\n\n` +
            `Use /checkin when you start working today! 💪\n\n` +
            `_Daily greeting sent at 8 AM_`
          );
        } catch (error) {
          this.logger.error(`Failed to send morning greeting to user ${user.telegramId}:`, error);
        }
      }

      this.logger.log(`Morning greetings sent to ${activeUsers.length} users`);
    } catch (error) {
      this.logger.error('Failed to send morning greetings:', error);
    }
  }

  private async sendMessageToUser(telegramId: string, message: string) {
    try {
      const bot = this.telegramService.getBotInstance();
      await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error(`Failed to send message to user ${telegramId}:`, error);
    }
  }

  private extractWorkingHours(statusMessage: string): number {
    const match = statusMessage.match(/Currently working for: ([\d.]+) hours/);
    return match ? parseFloat(match[1]) : 0;
  }

  // Manual trigger methods for testing
  async triggerDailyReport() {
    this.logger.log('Manually triggering daily reports...');
    await this.sendDailyReports();
  }

  async triggerWeeklyReport() {
    this.logger.log('Manually triggering weekly reports...');
    await this.sendWeeklyReports();
  }

  async triggerMonthlyReport() {
    this.logger.log('Manually triggering monthly reports...');
    await this.sendMonthlyReports();
  }
}