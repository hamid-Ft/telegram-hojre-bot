import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import * as moment from 'moment-timezone';
import { WorkSession } from '../entities/work-session.entity';
import { TimeEntry } from '../entities/time-entry.entity';
import { UserService } from './user.service';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(WorkSession)
    private workSessionRepository: Repository<WorkSession>,
    @InjectRepository(TimeEntry)
    private timeEntryRepository: Repository<TimeEntry>,
    private userService: UserService,
  ) {}

  async getDailyReport(telegramId: string, date?: string): Promise<string> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return '❌ User not found. Please start the bot with /start';
      }

      const targetDate = date || moment.tz(user.timezone).format('YYYY-MM-DD');
      const workSession = await this.workSessionRepository.findOne({
        where: { telegramId, date: targetDate },
      });

      const formattedDate = moment(targetDate).format('MMMM Do, YYYY');
      let report = `📊 **Daily Report - ${formattedDate}**\n\n`;

      if (!workSession || (!workSession.checkIn && !workSession.checkOut)) {
        report += `📍 Status: No activity recorded\n`;
        report += `⏱️ Total hours: 0.00\n\n`;
        report += `💡 *Use /checkin and /checkout to start tracking your time!*`;
        return report;
      }

      // Status
      const isComplete = workSession.isComplete;
      const statusIcon = isComplete ? '✅' : '🟡';
      const statusText = isComplete ? 'Completed' : 'Incomplete';
      
      report += `${statusIcon} Status: ${statusText}\n`;

      // Times
      if (workSession.checkIn) {
        const checkInTime = moment.tz(workSession.checkIn, user.timezone).format('HH:mm');
        report += `📍 Check-in: ${checkInTime}\n`;
      }

      if (workSession.checkOut) {
        const checkOutTime = moment.tz(workSession.checkOut, user.timezone).format('HH:mm');
        report += `📤 Check-out: ${checkOutTime}\n`;
      }

      // Hours
      const totalHours = parseFloat(workSession.totalHours.toString());
      report += `⏱️ Total hours: ${totalHours.toFixed(2)}\n`;

      // Break time
      if (workSession.breakMinutes && workSession.breakMinutes > 0) {
        report += `☕ Break time: ${workSession.breakMinutes} minutes\n`;
      }

      // Additional info for incomplete sessions
      if (!isComplete && workSession.checkIn) {
        const currentTime = moment.tz(user.timezone);
        const workingTime = moment.duration(currentTime.diff(moment(workSession.checkIn))).asHours();
        report += `\n🕐 Currently working for: ${workingTime.toFixed(1)} hours`;
      }

      return report;
    } catch (error) {
      console.error('Daily report error:', error);
      return '❌ An error occurred while generating the daily report.';
    }
  }

  async getWeeklyReport(telegramId: string): Promise<string> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return '❌ User not found. Please start the bot with /start';
      }

      const now = moment.tz(user.timezone);
      const startOfWeek = now.clone().startOf('isoWeek').format('YYYY-MM-DD');
      const endOfWeek = now.clone().endOf('isoWeek').format('YYYY-MM-DD');

      const workSessions = await this.workSessionRepository.find({
        where: {
          telegramId,
          date: Between(startOfWeek, endOfWeek),
        },
        order: { date: 'ASC' },
      });

      const weekRange = `${moment(startOfWeek).format('MMM Do')} - ${moment(endOfWeek).format('MMM Do, YYYY')}`;
      let report = `📊 **Weekly Report - ${weekRange}**\n\n`;

      if (workSessions.length === 0) {
        report += `📍 No activity recorded this week\n`;
        report += `⏱️ Total hours: 0.00\n\n`;
        report += `💡 *Start tracking your time with /checkin!*`;
        return report;
      }

      let totalHours = 0;
      let workingDays = 0;
      const dailyBreakdown: string[] = [];

      // Process each day
      for (let i = 0; i < 7; i++) {
        const date = moment(startOfWeek).add(i, 'days').format('YYYY-MM-DD');
        const dayName = moment(date).format('dddd');
        const session = workSessions.find(s => s.date === date);

        if (session && (session.checkIn || session.checkOut)) {
          const hours = parseFloat(session.totalHours.toString());
          totalHours += hours;
          workingDays++;

          const statusIcon = session.isComplete ? '✅' : session.checkIn ? '🟡' : '⚪';
          dailyBreakdown.push(`${statusIcon} ${dayName}: ${hours.toFixed(2)}h`);
        } else {
          dailyBreakdown.push(`⚪ ${dayName}: 0.00h`);
        }
      }

      // Summary
      report += `📈 **Summary**\n`;
      report += `⏱️ Total hours: ${totalHours.toFixed(2)}\n`;
      report += `📅 Working days: ${workingDays}/7\n`;
      if (workingDays > 0) {
        report += `⚡ Average per day: ${(totalHours / workingDays).toFixed(2)}h\n`;
      }

      report += `\n📊 **Daily Breakdown**\n`;
      dailyBreakdown.forEach(day => {
        report += `${day}\n`;
      });

      return report;
    } catch (error) {
      console.error('Weekly report error:', error);
      return '❌ An error occurred while generating the weekly report.';
    }
  }

  async getMonthlyReport(telegramId: string, month?: string): Promise<string> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return '❌ User not found. Please start the bot with /start';
      }

      const now = moment.tz(user.timezone);
      const targetMonth = month ? moment(month) : now;
      const startOfMonth = targetMonth.clone().startOf('month').format('YYYY-MM-DD');
      const endOfMonth = targetMonth.clone().endOf('month').format('YYYY-MM-DD');

      const workSessions = await this.workSessionRepository.find({
        where: {
          telegramId,
          date: Between(startOfMonth, endOfMonth),
        },
        order: { date: 'ASC' },
      });

      const monthName = targetMonth.format('MMMM YYYY');
      let report = `📊 **Monthly Report - ${monthName}**\n\n`;

      if (workSessions.length === 0) {
        report += `📍 No activity recorded this month\n`;
        report += `⏱️ Total hours: 0.00\n\n`;
        report += `💡 *Start tracking your time with /checkin!*`;
        return report;
      }

      let totalHours = 0;
      let workingDays = 0;
      let completedDays = 0;
      const weeklyBreakdown: { [week: string]: { hours: number; days: number } } = {};

      workSessions.forEach(session => {
        if (session.checkIn || session.checkOut) {
          const hours = parseFloat(session.totalHours.toString());
          totalHours += hours;
          workingDays++;

          if (session.isComplete) {
            completedDays++;
          }

          // Group by week
          const weekStart = moment(session.date).startOf('isoWeek').format('MMM Do');
          const weekEnd = moment(session.date).endOf('isoWeek').format('MMM Do');
          const weekKey = `${weekStart} - ${weekEnd}`;

          if (!weeklyBreakdown[weekKey]) {
            weeklyBreakdown[weekKey] = { hours: 0, days: 0 };
          }
          weeklyBreakdown[weekKey].hours += hours;
          weeklyBreakdown[weekKey].days++;
        }
      });

      // Summary
      report += `📈 **Summary**\n`;
      report += `⏱️ Total hours: ${totalHours.toFixed(2)}\n`;
      report += `📅 Working days: ${workingDays}\n`;
      report += `✅ Completed days: ${completedDays}\n`;
      if (workingDays > 0) {
        report += `⚡ Average per day: ${(totalHours / workingDays).toFixed(2)}h\n`;
      }

      // Weekly breakdown
      if (Object.keys(weeklyBreakdown).length > 0) {
        report += `\n📊 **Weekly Breakdown**\n`;
        Object.entries(weeklyBreakdown).forEach(([week, data]) => {
          report += `📅 ${week}: ${data.hours.toFixed(2)}h (${data.days} days)\n`;
        });
      }

      // Find best and worst days
      if (workSessions.length > 0) {
        const sessionsWithHours = workSessions
          .filter(s => s.totalHours > 0)
          .sort((a, b) => parseFloat(b.totalHours.toString()) - parseFloat(a.totalHours.toString()));

        if (sessionsWithHours.length > 0) {
          const bestDay = sessionsWithHours[0];
          const worstDay = sessionsWithHours[sessionsWithHours.length - 1];

          report += `\n🏆 **Records**\n`;
          report += `🥇 Best day: ${moment(bestDay.date).format('MMM Do')} (${parseFloat(bestDay.totalHours.toString()).toFixed(2)}h)\n`;
          if (sessionsWithHours.length > 1) {
            report += `📉 Shortest day: ${moment(worstDay.date).format('MMM Do')} (${parseFloat(worstDay.totalHours.toString()).toFixed(2)}h)\n`;
          }
        }
      }

      return report;
    } catch (error) {
      console.error('Monthly report error:', error);
      return '❌ An error occurred while generating the monthly report.';
    }
  }

  async getRangeReport(telegramId: string, startDate: string, endDate: string): Promise<string> {
    try {
      const user = await this.userService.findByTelegramId(telegramId);
      if (!user) {
        return '❌ User not found. Please start the bot with /start';
      }

      // Validate dates
      if (!moment(startDate, 'YYYY-MM-DD', true).isValid() || !moment(endDate, 'YYYY-MM-DD', true).isValid()) {
        return '❌ Invalid date format. Please use YYYY-MM-DD format.';
      }

      const start = moment(startDate);
      const end = moment(endDate);

      if (start.isAfter(end)) {
        return '❌ Start date must be before or equal to end date.';
      }

      const workSessions = await this.workSessionRepository.find({
        where: {
          telegramId,
          date: Between(startDate, endDate),
        },
        order: { date: 'ASC' },
      });

      const range = `${start.format('MMM Do')} - ${end.format('MMM Do, YYYY')}`;
      let report = `📊 **Range Report - ${range}**\n\n`;

      if (workSessions.length === 0) {
        report += `📍 No activity recorded in this period\n`;
        report += `⏱️ Total hours: 0.00\n\n`;
        report += `💡 *Start tracking your time with /checkin!*`;
        return report;
      }

      let totalHours = 0;
      let workingDays = 0;
      let completedDays = 0;
      const totalDays = end.diff(start, 'days') + 1;

      workSessions.forEach(session => {
        if (session.checkIn || session.checkOut) {
          const hours = parseFloat(session.totalHours.toString());
          totalHours += hours;
          workingDays++;

          if (session.isComplete) {
            completedDays++;
          }
        }
      });

      // Summary
      report += `📈 **Summary**\n`;
      report += `⏱️ Total hours: ${totalHours.toFixed(2)}\n`;
      report += `📅 Working days: ${workingDays}/${totalDays}\n`;
      report += `✅ Completed days: ${completedDays}\n`;
      if (workingDays > 0) {
        report += `⚡ Average per working day: ${(totalHours / workingDays).toFixed(2)}h\n`;
        report += `📊 Work efficiency: ${((workingDays / totalDays) * 100).toFixed(1)}%\n`;
      }

      // Show recent days if range is not too long
      if (totalDays <= 14) {
        report += `\n📊 **Daily Breakdown**\n`;
        for (let i = 0; i < totalDays; i++) {
          const date = start.clone().add(i, 'days').format('YYYY-MM-DD');
          const dayName = moment(date).format('ddd, MMM Do');
          const session = workSessions.find(s => s.date === date);

          if (session && (session.checkIn || session.checkOut)) {
            const hours = parseFloat(session.totalHours.toString());
            const statusIcon = session.isComplete ? '✅' : session.checkIn ? '🟡' : '⚪';
            report += `${statusIcon} ${dayName}: ${hours.toFixed(2)}h\n`;
          } else {
            report += `⚪ ${dayName}: 0.00h\n`;
          }
        }
      }

      return report;
    } catch (error) {
      console.error('Range report error:', error);
      return '❌ An error occurred while generating the range report.';
    }
  }
}