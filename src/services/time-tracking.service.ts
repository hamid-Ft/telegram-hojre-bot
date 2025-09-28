import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
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
		@InjectRepository(TimeEntry) private timeEntryRepo: Repository<TimeEntry>,
		@InjectRepository(WorkSession) private workSessionRepo: Repository<WorkSession>,
		private users: UserService,
		private config: ConfigService
	) {}

	private dayBounds(ts: Date, tz: string) {
		const start = moment.tz(ts, tz).startOf('day').toDate();
		const end = moment.tz(ts, tz).endOf('day').toDate();
		return { start, end };
	}

	private accumulateHours(entries: TimeEntry[]) {
		const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
		let total = 0;
		let openIn: Date | null = null;

		for (const e of sorted) {
			if (e.type === EntryType.CHECK_IN) {
				if (!openIn) openIn = e.timestamp;
			} else if (e.type === EntryType.CHECK_OUT) {
				if (openIn) {
					total += moment(e.timestamp).diff(moment(openIn), 'minutes') / 60;
					openIn = null;
				}
			}
		}
		return parseFloat(total.toFixed(2));
	}

	async checkIn(telegramId: string, ts: Date, messageId?: string, note?: string): Promise<TimeTrackingResult> {
		try {
			const user = await this.users.findByTelegramId(telegramId);
			if (!user) return { success: false, message: 'User not found. Please start the bot first with /start' };

			const { start, end } = this.dayBounds(ts, user.timezone);
			const today = moment.tz(ts, user.timezone).format('YYYY-MM-DD');
			const formattedTime = moment.tz(ts, user.timezone).format('HH:mm');

			const todayEntries = await this.timeEntryRepo.find({
				where: { telegramId, timestamp: Between(start, end) },
				order: { timestamp: 'ASC' },
			});

			const todayIns = todayEntries.filter((e) => e.type === EntryType.CHECK_IN);
			const todayOuts = todayEntries.filter((e) => e.type === EntryType.CHECK_OUT);

			if (todayIns.length > todayOuts.length) {
				const lastIn = todayIns[todayIns.length - 1];
				const lastInTime = moment.tz(lastIn.timestamp, user.timezone).format('HH:mm');
				return {
					success: false,
					message: `You're already checked in today at ${lastInTime}. Please check out first.`,
				};
			}

			await this.timeEntryRepo.save(
				this.timeEntryRepo.create({
					telegramId,
					type: EntryType.CHECK_IN,
					timestamp: ts,
					note,
					messageId,
				})
			);

			await this.updateWorkSession(telegramId, today, user.timezone);
			return { success: true, message: 'Checked in successfully!', formattedTime, date: today };
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('Check-in error:', e);
			return { success: false, message: 'An error occurred during check-in. Please try again.' };
		}
	}

	async checkOut(telegramId: string, ts: Date, messageId?: string, note?: string): Promise<TimeTrackingResult> {
		try {
			const user = await this.users.findByTelegramId(telegramId);
			if (!user) return { success: false, message: 'User not found. Please start the bot first with /start' };

			const { start, end } = this.dayBounds(ts, user.timezone);
			const today = moment.tz(ts, user.timezone).format('YYYY-MM-DD');
			const formattedTime = moment.tz(ts, user.timezone).format('HH:mm');

			const todayEntries = await this.timeEntryRepo.find({
				where: { telegramId, timestamp: Between(start, end) },
				order: { timestamp: 'ASC' },
			});

			const ins = todayEntries.filter((e) => e.type === EntryType.CHECK_IN);
			const outs = todayEntries.filter((e) => e.type === EntryType.CHECK_OUT);

			if (ins.length === 0) {
				return { success: false, message: 'You need to check in first before checking out.' };
			}
			if (outs.length >= ins.length) {
				return { success: false, message: 'You are already checked out. Use /checkin to start a new session.' };
			}

			await this.timeEntryRepo.save(
				this.timeEntryRepo.create({
					telegramId,
					type: EntryType.CHECK_OUT,
					timestamp: ts,
					note,
					messageId,
				})
			);

			const session = await this.updateWorkSession(telegramId, today, user.timezone);
			return {
				success: true,
				message: 'Checked out successfully!',
				formattedTime,
				date: today,
				totalHours: session.totalHours.toString(),
			};
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('Check-out error:', e);
			return { success: false, message: 'An error occurred during check-out. Please try again.' };
		}
	}

	async getTodayStatus(telegramId: string): Promise<string> {
		try {
			const user = await this.users.findByTelegramId(telegramId);
			if (!user) return '❌ User not found. Please start the bot with /start';

			const today = moment.tz(user.timezone).format('YYYY-MM-DD');
			const ws = await this.workSessionRepo.findOne({ where: { telegramId, date: today } });

			if (!ws) {
				return `📅 **Today's Status (${today})**\n\n📍 Status: Not checked in\n⏱️ Total hours: 0.00\n\nUse /checkin to start tracking your work time! 🚀`;
			}

			const working = !!ws.checkIn && !ws.checkOut;
			const statusIcon = working ? '🟢' : ws.isComplete ? '✅' : '🟡';
			const statusText = working ? 'Currently working' : ws.isComplete ? 'Completed' : 'Partially logged';

			let msg = `📅 **Today's Status (${today})**\n\n${statusIcon} Status: ${statusText}\n`;
			if (ws.checkIn) msg += `📍 Check-in: ${moment.tz(ws.checkIn, user.timezone).format('HH:mm')}\n`;
			if (ws.checkOut) msg += `📤 Check-out: ${moment.tz(ws.checkOut, user.timezone).format('HH:mm')}\n`;
			msg += `⏱️ Total hours: ${parseFloat(ws.totalHours.toString()).toFixed(2)}\n`;

			if (working) {
				const current = moment.duration(moment().diff(ws.checkIn)).asHours();
				msg += `\n🕐 Currently working for: ${current.toFixed(1)} hours`;
			}
			return msg;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error('Status error:', e);
			return '❌ An error occurred while fetching your status.';
		}
	}

	private async updateWorkSession(telegramId: string, date: string, tz: string): Promise<WorkSession> {
		let ws = await this.workSessionRepo.findOne({ where: { telegramId, date } });
		if (!ws) {
			ws = this.workSessionRepo.create({ telegramId, date, totalHours: 0, breakMinutes: 0, isComplete: false });
		}

		const start = moment.tz(date, tz).startOf('day').toDate();
		const end = moment.tz(date, tz).endOf('day').toDate();

		const entries = await this.timeEntryRepo.find({
			where: { telegramId, timestamp: Between(start, end) },
			order: { timestamp: 'ASC' },
		});

		const firstIn = entries.find((e) => e.type === EntryType.CHECK_IN)?.timestamp ?? null;
		const lastOut = [...entries].reverse().find((e) => e.type === EntryType.CHECK_OUT)?.timestamp ?? null;

		ws.checkIn = firstIn;
		ws.checkOut = lastOut;
		ws.totalHours = this.accumulateHours(entries);

		const last = entries[entries.length - 1];
		ws.isComplete = !!last && last.type === EntryType.CHECK_OUT;

		return this.workSessionRepo.save(ws);
	}
}
