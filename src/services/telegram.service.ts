// src/services/telegram.service.ts
import { Context, Telegraf, session } from 'telegraf';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment-timezone';
import { ReportService } from './report.service';
import { TimeTrackingService } from './time-tracking.service';
import { UserService } from './user.service';

type FlowName = 'checkin' | 'checkout' | 'report_range';

interface FlowState {
	name: FlowName;
	step: number;
	data: Record<string, any>;
	threadId?: number;
}

interface TelegramSession {
	flow?: FlowState;
}

interface TelegramContext extends Context {
	match?: RegExpExecArray | null;
	session: TelegramSession;
}

@Injectable()
export class TelegramService implements OnModuleInit {
	private readonly logger = new Logger(TelegramService.name);
	private bot: Telegraf<TelegramContext>;

	constructor(
		private configService: ConfigService,
		private timeTrackingService: TimeTrackingService,
		private reportService: ReportService,
		private userService: UserService
	) {
		const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
		if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

		this.bot = new Telegraf<TelegramContext>(token);
		this.bot.use(session()); // enable flows
		this.setupCommands();
	}

	async onModuleInit() {
		await this.setupWebhook();
		this.logger.log('Telegram bot initialized successfully');
	}

	private async setupWebhook() {
		const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
		if (!webhookUrl) {
			this.logger.warn('TELEGRAM_WEBHOOK_URL is not set; webhook not configured.');
			return;
		}
		await this.bot.telegram.setWebhook(webhookUrl /*, { drop_pending_updates: true }*/);
		this.logger.log(`Webhook set to: ${webhookUrl}`);
	}

	/** Current topic/thread id */
	private getThreadId(ctx: TelegramContext): number | undefined {
		const m: any = (ctx as any).message ?? (ctx as any).callbackQuery?.message;
		return m?.message_thread_id as number | undefined;
	}

	/** Reply in the same topic/thread */
	private async replyInThread(
		ctx: TelegramContext,
		text: string,
		extra: Parameters<Telegraf<TelegramContext>['telegram']['sendMessage']>[2] = {}
	) {
		const chatId = ctx.chat!.id;
		const threadId = this.getThreadId(ctx) ?? ctx.session?.flow?.threadId;
		const options = { ...extra, ...(threadId ? { message_thread_id: threadId } : {}) };
		return ctx.telegram.sendMessage(chatId, text, options);
	}

	/** Parse HH:mm in the user's timezone */
	private async parseUserTime(ctx: TelegramContext, hhmm: string): Promise<Date | null> {
		const user = await this.userService.findByTelegramId(String(ctx.from!.id));
		const tz = user?.timezone || this.configService.get('TIMEZONE') || 'Asia/Tehran';
		const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((hhmm || '').trim());
		if (!m) return null;

		const [, h, min] = m;
		const base = moment.tz(new Date(), tz);
		const dt = base.clone().hour(parseInt(h, 10)).minute(parseInt(min, 10)).second(0).millisecond(0);
		return dt.toDate();
	}

	/** Strict date validator YYYY-MM-DD */
	private isDate(s: string) {
		return moment(s, 'YYYY-MM-DD', true).isValid();
	}

	private setupCommands() {
		// /start
		this.bot.start(async (ctx) => {
			await this.userService.createOrUpdateUser(ctx.from);
			const msg = `
🎯 *Welcome to Time Tracker Bot!*

Use */menu* to open actions inside this topic.

Shortcuts:
• /checkin \`[HH:mm]\`
• /checkout \`[HH:mm]\`
• /report daily|weekly|monthly|range YYYY-MM-DD YYYY-MM-DD
• /status
• /cancel (cancel current form)
      `;
			await this.replyInThread(ctx, msg, { parse_mode: 'Markdown' });
		});

		// QUICK manual time variants without the full form
		this.bot.hears(/^\/checkin(?:\s+(\d{1,2}:\d{2}))?$/, async (ctx) => {
			const hhmm = ctx.match?.[1];
			const ts = hhmm ? await this.parseUserTime(ctx, hhmm) : new Date();
			if (!ts) return this.replyInThread(ctx, '❌ Time format invalid. Use HH:mm, e.g. 09:10');

			const r = await this.timeTrackingService.checkIn(
				String(ctx.from!.id),
				ts,
				String((ctx.message as any)?.message_id)
			);
			await this.replyInThread(
				ctx,
				r.success ? `✅ *Checked in* at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
				{ parse_mode: 'Markdown' }
			);
		});

		this.bot.hears(/^\/checkout(?:\s+(\d{1,2}:\d{2}))?$/, async (ctx) => {
			const hhmm = ctx.match?.[1];
			const ts = hhmm ? await this.parseUserTime(ctx, hhmm) : new Date();
			if (!ts) return this.replyInThread(ctx, '❌ Time format invalid. Use HH:mm, e.g. 18:25');

			const r = await this.timeTrackingService.checkOut(
				String(ctx.from!.id),
				ts,
				String((ctx.message as any)?.message_id)
			);
			await this.replyInThread(
				ctx,
				r.success
					? `✅ *Checked out* at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
					: `❌ ${r.message}`,
				{ parse_mode: 'Markdown' }
			);
		});

		// /status
		this.bot.command('status', async (ctx) => {
			const s = await this.timeTrackingService.getTodayStatus(String(ctx.from!.id));
			await this.replyInThread(ctx, s, { parse_mode: 'Markdown' });
		});

		// /report <type>
		this.bot.hears(/^\/report\s+(\w+)(.*)/, async (ctx) => {
			try {
				const type = ctx.match![1]?.toLowerCase();
				const params = ctx.match![2]?.trim();
				const userId = String(ctx.from!.id);

				if (type === 'daily') {
					const out = await this.reportService.getDailyReport(userId);
					return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
				}
				if (type === 'weekly') {
					const out = await this.reportService.getWeeklyReport(userId);
					return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
				}
				if (type === 'monthly') {
					const out = await this.reportService.getMonthlyReport(userId);
					return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
				}
				if (type === 'range') {
					const [d1, d2, maybeUser] = (params || '').split(/\s+/).filter(Boolean);
					if (!d1 || !d2) {
						return this.replyInThread(ctx, '❌ Use: /report range YYYY-MM-DD YYYY-MM-DD [@username]');
					}
					let targetId = userId;
					if (maybeUser && maybeUser.startsWith('@')) {
						const u = await this.userService.findByUsername(maybeUser.replace('@', ''));
						if (!u) return this.replyInThread(ctx, `❌ User ${maybeUser} not found in database.`);
						targetId = u.telegramId;
					}
					const out = await this.reportService.getRangeReport(targetId, d1, d2);
					return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
				}

				return this.replyInThread(ctx, '❌ Use: daily | weekly | monthly | range');
			} catch {
				return this.replyInThread(ctx, '❌ Report error.');
			}
		});

		// /menu → inline actions (and start flows)
		this.bot.command('menu', async (ctx) => {
			const threadId = this.getThreadId(ctx);
			await ctx.telegram.sendMessage(ctx.chat!.id, 'Choose an action:', {
				...(threadId ? { message_thread_id: threadId } : {}),
				reply_markup: {
					inline_keyboard: [
						[{ text: 'Check-in (manual)', callback_data: 'flow_checkin' }],
						[{ text: 'Check-out (manual)', callback_data: 'flow_checkout' }],
						[{ text: 'Report (date range)', callback_data: 'flow_report_range' }],
						[{ text: 'Status (today)', callback_data: 'do_status' }],
						[{ text: 'Help', callback_data: 'do_help' }],
					],
				},
			});
		});

		// Callback routes
		this.bot.on('callback_query', async (ctx) => {
			const data = (ctx.callbackQuery as any)?.data as string | undefined;
			const threadId = this.getThreadId(ctx);

			if (data === 'flow_checkin') {
				ctx.session.flow = { name: 'checkin', step: 1, data: {}, threadId };
				await this.replyInThread(ctx, '🕐 Enter check-in time (HH:mm), e.g. 09:10');
				return void ctx.answerCbQuery();
			}
			if (data === 'flow_checkout') {
				ctx.session.flow = { name: 'checkout', step: 1, data: {}, threadId };
				await this.replyInThread(ctx, '🕐 Enter check-out time (HH:mm), e.g. 18:25');
				return void ctx.answerCbQuery();
			}
			if (data === 'flow_report_range') {
				ctx.session.flow = { name: 'report_range', step: 1, data: {}, threadId };
				await this.replyInThread(ctx, '📅 Start date? (YYYY-MM-DD)');
				return void ctx.answerCbQuery();
			}
			if (data === 'do_status') {
				const out = await this.timeTrackingService.getTodayStatus(String(ctx.from!.id));
				await this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
				return void ctx.answerCbQuery();
			}
			if (data === 'do_help') {
				await this.replyInThread(
					ctx,
					'Use /menu to open actions.\n/checkin [HH:mm], /checkout [HH:mm], /status, /report ...\n/cancel to cancel current form.'
				);
				return void ctx.answerCbQuery();
			}

			await ctx.answerCbQuery();
		});

		// Flow processor for text messages
		this.bot.on('text', async (ctx, next) => {
			const flow = ctx.session.flow;
			if (!flow) return next();

			const userId = String(ctx.from!.id);

			try {
				// CHECK-IN FLOW
				if (flow.name === 'checkin') {
					if (flow.step === 1) {
						const ts = await this.parseUserTime(ctx, ctx.message.text);
						if (!ts) return this.replyInThread(ctx, '❌ Time format invalid. Use HH:mm (e.g., 09:10)');
						flow.data.timestamp = ts;
						flow.step = 2;
						return this.replyInThread(ctx, 'Any note? (or "-" to skip)');
					}
					if (flow.step === 2) {
						const note = ctx.message.text?.trim();
						const r = await this.timeTrackingService.checkIn(
							userId,
							flow.data.timestamp,
							undefined,
							note === '-' ? undefined : note
						);
						ctx.session.flow = undefined;
						return this.replyInThread(
							ctx,
							r.success ? `✅ *Checked in* at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				// CHECK-OUT FLOW
				if (flow.name === 'checkout') {
					if (flow.step === 1) {
						const ts = await this.parseUserTime(ctx, ctx.message.text);
						if (!ts) return this.replyInThread(ctx, '❌ Time format invalid. Use HH:mm (e.g., 18:25)');
						flow.data.timestamp = ts;
						flow.step = 2;
						return this.replyInThread(ctx, 'Any note? (or "-" to skip)');
					}
					if (flow.step === 2) {
						const note = ctx.message.text?.trim();
						const r = await this.timeTrackingService.checkOut(
							userId,
							flow.data.timestamp,
							undefined,
							note === '-' ? undefined : note
						);
						ctx.session.flow = undefined;
						return this.replyInThread(
							ctx,
							r.success
								? `✅ *Checked out* at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
								: `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				// REPORT RANGE FLOW
				if (flow.name === 'report_range') {
					if (flow.step === 1) {
						const d = ctx.message.text.trim();
						if (!this.isDate(d)) return this.replyInThread(ctx, '❌ Use YYYY-MM-DD');
						flow.data.start = d;
						flow.step = 2;
						return this.replyInThread(ctx, 'End date? (YYYY-MM-DD)');
					}
					if (flow.step === 2) {
						const d = ctx.message.text.trim();
						if (!this.isDate(d)) return this.replyInThread(ctx, '❌ Use YYYY-MM-DD');
						flow.data.end = d;
						flow.step = 3;
						// ask who
						return this.replyInThread(ctx, 'For whom?', {
							reply_markup: {
								inline_keyboard: [
									[{ text: 'Me', callback_data: 'report_me' }],
									[{ text: 'By username', callback_data: 'report_by_username' }],
								],
							},
						});
					}
				}
			} catch (e) {
				this.logger.error('Flow error', e as any);
				ctx.session.flow = undefined;
				return this.replyInThread(ctx, '❌ Flow cancelled due to an error.');
			}
		});

		// Mini-callbacks inside report flow (Me / By username)
		this.bot.action('report_me', async (ctx) => {
			const flow = ctx.session.flow;
			if (!flow || flow.name !== 'report_range') return ctx.answerCbQuery();
			const start = flow.data.start;
			const end = flow.data.end;
			const out = await this.reportService.getRangeReport(String(ctx.from!.id), start, end);
			ctx.session.flow = undefined;
			await this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
			await ctx.answerCbQuery();
		});

		this.bot.action('report_by_username', async (ctx) => {
			const flow = ctx.session.flow;
			if (!flow || flow.name !== 'report_range') return ctx.answerCbQuery();
			flow.step = 4;
			await this.replyInThread(ctx, 'Send @username of the user (must have used the bot at least once).');
			await ctx.answerCbQuery();
		});

		// Continue report flow step 4 (username input)
		this.bot.on('text', async (ctx, next) => {
			const flow = ctx.session.flow;
			if (!flow || flow.name !== 'report_range' || flow.step !== 4) return next();

			const txt = ctx.message.text.trim();
			if (!txt.startsWith('@')) {
				return this.replyInThread(ctx, '❌ Please send a valid @username, e.g., @john');
			}
			const u = await this.userService.findByUsername(txt.replace('@', ''));
			if (!u) {
				return this.replyInThread(ctx, `❌ User ${txt} not found in database.`);
			}

			const out = await this.reportService.getRangeReport(u.telegramId, flow.data.start, flow.data.end);
			ctx.session.flow = undefined;
			return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
		});

		// /cancel
		this.bot.command('cancel', async (ctx) => {
			if (ctx.session.flow) {
				ctx.session.flow = undefined;
				await this.replyInThread(ctx, '❌ Current form cancelled.');
			} else {
				await this.replyInThread(ctx, 'No active form.');
			}
		});

		// /help
		this.bot.help(async (ctx) => {
			const help = `
Use */menu* in this topic.

Manual:
• /checkin [HH:mm]
• /checkout [HH:mm]
• /report daily|weekly|monthly|range YYYY-MM-DD YYYY-MM-DD [@username]
• /status
• /cancel
`;
			await this.replyInThread(ctx, help, { parse_mode: 'Markdown' });
		});

		// Global error catch
		this.bot.catch((err, ctx) => {
			this.logger.error(`Bot error for ${ctx.updateType}:`, err as any);
			try {
				this.replyInThread(ctx, '❌ Something went wrong.');
			} catch {}
		});
	}

	getBotInstance() {
		return this.bot;
	}

	async handleUpdate(update: any) {
		return this.bot.handleUpdate(update);
	}
}
