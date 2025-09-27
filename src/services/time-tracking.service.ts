import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment-timezone';
import { TimeEntry, EntryType } from '../entities/time-entry.entity';
import { WorkSession } from '../entities/work-session.entity';
import { UserService } from './user.service';

interface TimeTrackingResult {
  success: boolean;
  message: string;
  formattedTime?: string;
  date?: string;
  totalHours?: string;
}

@Injectable()
export class TimeTrackingService {
  constructor(
    @InjectRepository(TimeEntry)
    private timeEntryRepository: Repository<TimeEntry>,
    @InjectRepository(WorkSession)
    private workSessionRepository: Repository<WorkSession>,
    private userService: UserService,
    private configService: ConfigService,
  ) {}

  async checkIn(
    telegramId: string,
    timestamp: Date,
    messageId?: string,
    note?: string,
  ): Promise<TimeTrackingResult> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return {
          success: false,
          message: 'User not found. Please start the bot first with /start',
        };
      }

      const today = moment.tz(timestamp, user.timezone).format('YYYY-MM-DD');
      const formattedTime = moment.tz(timestamp, user.timezone).format('HH:mm');

      // Check if already checked in today
      const existingCheckIn = await this.timeEntryRepository.findOne({
        where: {
          telegramId,
          type: EntryType.CHECK_IN,
          timestamp: moment.tz(timestamp, user.timezone).startOf('day').toDate(),
        },
        order: { timestamp: 'DESC' },
      });

      // More flexible check - look for today's entries
      const todayEntries = await this.timeEntryRepository.find({
        where: {
          telegramId,
          timestamp: moment.tz(today, user.timezone).toDate(),
        },
        order: { timestamp: 'DESC' },
      });

      const todayCheckIns = todayEntries.filter(e => e.type === EntryType.CHECK_IN);
      const todayCheckOuts = todayEntries.filter(e => e.type === EntryType.CHECK_OUT);

      // If there are more check-ins than check-outs, user is already checked in
      if (todayCheckIns.length > todayCheckOuts.length) {
        const lastCheckIn = todayCheckIns[0];
        const lastCheckInTime = moment.tz(lastCheckIn.timestamp, user.timezone).format('HH:mm');
        return {
          success: false,
          message: `You're already checked in today at ${lastCheckInTime}. Please check out first.`,
        };
      }

      // Create check-in entry
      const checkInEntry = this.timeEntryRepository.create({
        telegramId,
        type: EntryType.CHECK_IN,
        timestamp,
        note,
        messageId,
      });

      await this.timeEntryRepository.save(checkInEntry);

      // Create or update work session
      await this.updateWorkSession(telegramId, today, user.timezone);

      return {
        success: true,
        message: 'Checked in successfully!',
        formattedTime,
        date: moment.tz(timestamp, user.timezone).format('YYYY-MM-DD'),
      };
    } catch (error) {
      console.error('Check-in error:', error);
      return {
        success: false,
        message: 'An error occurred during check-in. Please try again.',
      };
    }
  }

  async checkOut(
    telegramId: string,
    timestamp: Date,
    messageId?: string,
    note?: string,
  ): Promise<TimeTrackingResult> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return {
          success: false,
          message: 'User not found. Please start the bot first with /start',
        };
      }

      const today = moment.tz(timestamp, user.timezone).format('YYYY-MM-DD');
      const formattedTime = moment.tz(timestamp, user.timezone).format('HH:mm');

      // Get today's entries
      const startOfDay = moment.tz(today, user.timezone).startOf('day').toDate();
      const endOfDay = moment.tz(today, user.timezone).endOf('day').toDate();

      const todayEntries = await this.timeEntryRepository.find({
        where: {
          telegramId,
          timestamp: moment.tz(timestamp, user.timezone).toDate(),
        },
        order: { timestamp: 'ASC' },
      });

      const checkIns = todayEntries.filter(e => e.type === EntryType.CHECK_IN);
      const checkOuts = todayEntries.filter(e => e.type === EntryType.CHECK_OUT);

      if (checkIns.length === 0) {
        return {
          success: false,
          message: 'You need to check in first before checking out.',
        };
      }

      if (checkOuts.length >= checkIns.length) {
        return {
          success: false,
          message: 'You are already checked out. Use /checkin to start a new session.',
        };
      }

      // Create check-out entry
      const checkOutEntry = this.timeEntryRepository.create({
        telegramId,
        type: EntryType.CHECK_OUT,
        timestamp,
        note,
        messageId,
      });

      await this.timeEntryRepository.save(checkOutEntry);

      // Update work session
      const workSession = await this.updateWorkSession(telegramId, today, user.timezone);

      return {
        success: true,
        message: 'Checked out successfully!',
        formattedTime,
        date: today,
        totalHours: workSession.totalHours.toString(),
      };
    } catch (error) {
      console.error('Check-out error:', error);
      return {
        success: false,
        message: 'An error occurred during check-out. Please try again.',
      };
    }
  }

  async getTodayStatus(telegramId: string): Promise<string> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return '❌ User not found. Please start the bot with /start';
      }

      const today = moment.tz(user.timezone).format('YYYY-MM-DD');
      const workSession = await this.workSessionRepository.findOne({
        where: { telegramId, date: today },
      });

      if (!workSession) {
        return `📅 **Today's Status (${today})**\n\n` +
               `📍 Status: Not checked in\n` +
               `⏱️ Total hours: 0.00\n\n` +
               `Use /checkin to start tracking your work time! 🚀`;
      }

      const isCurrentlyWorking = workSession.checkIn && !workSession.checkOut;
      const statusIcon = isCurrentlyWorking ? '🟢' : workSession.isComplete ? '✅' : '🟡';
      const statusText = isCurrentlyWorking ? 'Currently working' : 
                        workSession.isComplete ? 'Completed' : 'Partially logged';

      let message = `📅 **Today's Status (${today})**\n\n`;
      message += `${statusIcon} Status: ${statusText}\n`;

      if (workSession.checkIn) {
        const checkInTime = moment.tz(workSession.checkIn, user.timezone).format('HH:mm');
        message += `📍 Check-in: ${checkInTime}\n`;
      }

      if (workSession.checkOut) {
        const checkOutTime = moment.tz(workSession.checkOut, user.timezone).format('HH:mm');
        message += `📤 Check-out: ${checkOutTime}\n`;
      }

      message += `⏱️ Total hours: ${parseFloat(workSession.totalHours.toString()).toFixed(2)}\n`;

      if (workSession.breaks && workSession.breaks.length > 0) {
        message += `☕ Break time: ${workSession.breakMinutes} minutes\n`;
      }

      if (isCurrentlyWorking) {
        const currentDuration = moment.duration(moment().diff(workSession.checkIn)).asHours();
        message += `\n🕐 Currently working for: ${currentDuration.toFixed(1)} hours`;
      }

      return message;
    } catch (error) {
      console.error('Status error:', error);
      return '❌ An error occurred while fetching your status.';
    }
  }

  private async updateWorkSession(
    telegramId: string,
    date: string,
    timezone: string,
  ): Promise<WorkSession> {
    let workSession = await this.workSessionRepository.findOne({
      where: { telegramId, date },
    });

    if (!workSession) {
      workSession = this.workSessionRepository.create({
        telegramId,
        date,
        totalHours: 0,
        breakMinutes: 0,
        isComplete: false,
      });
    }

    // Get all entries for this day
    const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
    const endOfDay = moment.tz(date, timezone).endOf('day').toDate();

    const entries = await this.timeEntryRepository.find({
      where: {
        telegramId,
        timestamp: startOfDay, // This might need adjustment for proper date range query
      },
      order: { timestamp: 'ASC' },
    });

    const checkIns = entries.filter(e => e.type === EntryType.CHECK_IN);
    const checkOuts = entries.filter(e => e.type === EntryType.CHECK_OUT);

    if (checkIns.length > 0) {
      workSession.checkIn = checkIns[0].timestamp;
    }

    if (checkOuts.length > 0) {
      workSession.checkOut = checkOuts[checkOuts.length - 1].timestamp;
    }

    // Calculate total hours
    if (workSession.checkIn && workSession.checkOut) {
      const duration = moment.duration(moment(workSession.checkOut).diff(moment(workSession.checkIn)));
      workSession.totalHours = parseFloat(duration.asHours().toFixed(2));
      workSession.isComplete = true;
    } else if (workSession.checkIn) {
      // Currently working - calculate current duration
      const duration = moment.duration(moment().diff(moment(workSession.checkIn)));
      workSession.totalHours = parseFloat(duration.asHours().toFixed(2));
      workSession.isComplete = false;
    }

    return await this.workSessionRepository.save(workSession);
  }
}