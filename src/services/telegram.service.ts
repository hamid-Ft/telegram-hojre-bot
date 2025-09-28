import { Context, Telegraf, session } from 'telegraf';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as moment from 'moment-timezone';

import { ReportService } from './report.service';
import { TimeTrackingService } from './time-tracking.service';
import { UserService } from './user.service';

type FlowName = 'checkin_manual' | 'checkout_manual' | 'my_report_range' | 'user_report_range';

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
		private config: ConfigService,
		private timeTracking: TimeTrackingService,
		private reports: ReportService,
		private users: UserService
	) {
		const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
		if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

		this.bot = new Telegraf<TelegramContext>(token);
		// Enable per-user session for flows
		this.bot.use(session());

		this.setupCommandsAndFlows();
	}

	async onModuleInit() {
		const webhookUrl = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
		if (webhookUrl) {
			await this.bot.telegram.setWebhook(webhookUrl);
			this.logger.log(`Webhook set to: ${webhookUrl}`);
		} else {
			this.logger.warn('TELEGRAM_WEBHOOK_URL is not set; webhook not configured.');
		}
		this.logger.log('Telegram bot initialized successfully');
	}

	getBotInstance() {
		return this.bot;
	}

	async handleUpdate(update: any) {
		return this.bot.handleUpdate(update);
	}

	// ---------- helpers ----------

	/** Extract current topic/thread id from any update type */
	private getThreadId(ctx: TelegramContext): number | undefined {
		const m: any = (ctx as any).message ?? (ctx as any).callbackQuery?.message;
		return m?.message_thread_id as number | undefined;
	}

	/** Reply into the same topic/thread */
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

	private logCallback(ctx: TelegramContext, tag: string) {
		const cq: any = (ctx as any).callbackQuery;
		const msg: any = cq?.message;
		this.logger.warn(
			`[${tag}] data=${cq?.data} chat=${msg?.chat?.id} thread=${msg?.message_thread_id} from=${cq?.from?.id}`
		);
	}

	/** Parse YYYY-MM-DD or the literal 'today' (in user's TZ). Returns ISO date string. */
	private parseDateOrToday(s: string, tz: string): string | null {
		const t = s.trim().toLowerCase();
		if (t === 'today') return moment.tz(tz).format('YYYY-MM-DD');
		if (!moment(t, 'YYYY-MM-DD', true).isValid()) return null;
		return t;
	}

	/** Parse HH:mm (24h). Returns {hh, mm} or null. */
	private parseHHmm(s: string): { hh: number; mm: number } | null {
		const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
		if (!m) return null;
		return { hh: parseInt(m[1], 10), mm: parseInt(m[2], 10) };
	}

	/** Build Date in user's TZ from local yyyy-mm-dd + hh:mm */
	private toUserDate(dateStr: string, hh: number, mm: number, tz: string): Date {
		return moment.tz(dateStr, 'YYYY-MM-DD', tz).hour(hh).minute(mm).second(0).millisecond(0).toDate();
	}

	// ---------- commands, menu & flows ----------

	private setupCommandsAndFlows() {
		// /start
		this.bot.start(async (ctx) => {
			await this.users.createOrUpdateUser(ctx.from);
			const welcome = [
				'🎯 *Welcome to Time Tracker Bot!*',
				'',
				'Use /menu to open the inline menu in this topic.',
				'',
				'*Quick commands*',
				'• /checkin — quick check-in (uses current time)',
				'• /checkout — quick check-out (uses current time)',
				'• /status — today status',
				'• /report daily|weekly|monthly|range YYYY-MM-DD YYYY-MM-DD',
				'',
				'*Forms (from /menu)*',
				'• Check-in (manual) → date + time',
				'• Check-out (manual) → date + time',
				'• My report (range) → start + end',
				'• User report (range) → pick user + start + end',
			].join('\n');
			await this.replyInThread(ctx, welcome, { parse_mode: 'Markdown' });
		});

		// Quick now checkin/checkout (kept)
		this.bot.command('checkin', async (ctx) => {
			try {
				await this.users.createOrUpdateUser(ctx.from);
				const r = await this.timeTracking.checkIn(
					String(ctx.from.id),
					new Date(),
					String((ctx.message as any)?.message_id ?? '')
				);
				await this.replyInThread(
					ctx,
					r.success ? `✅ *Checked in* at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
					{ parse_mode: 'Markdown' }
				);
			} catch (e) {
				this.logger.error('checkin failed', e as any);
				await this.replyInThread(ctx, '❌ An error occurred during check-in.');
			}
		});

		this.bot.command('checkout', async (ctx) => {
			try {
				const r = await this.timeTracking.checkOut(
					String(ctx.from.id),
					new Date(),
					String((ctx.message as any)?.message_id ?? '')
				);
				await this.replyInThread(
					ctx,
					r.success
						? `✅ *Checked out* at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
						: `❌ ${r.message}`,
					{ parse_mode: 'Markdown' }
				);
			} catch (e) {
				this.logger.error('checkout failed', e as any);
				await this.replyInThread(ctx, '❌ An error occurred during check-out.');
			}
		});

		// /status
		this.bot.command('status', async (ctx) => {
			try {
				const s = await this.timeTracking.getTodayStatus(String(ctx.from.id));
				await this.replyInThread(ctx, s, { parse_mode: 'Markdown' });
			} catch (e) {
				this.logger.error('status failed', e as any);
				await this.replyInThread(ctx, '❌ An error occurred while fetching status.');
			}
		});

		// /report ...
		this.bot.hears(/^\/report\s+(\w+)(.*)/, async (ctx) => {
			try {
				const type = ctx.match![1]?.toLowerCase();
				const params = ctx.match![2]?.trim();
				const userId = String(ctx.from.id);

				let out = '';
				if (type === 'daily') out = await this.reports.getDailyReport(userId);
				else if (type === 'weekly') out = await this.reports.getWeeklyReport(userId);
				else if (type === 'monthly') out = await this.reports.getMonthlyReport(userId);
				else if (type === 'range') {
					const [d1, d2] = (params || '').split(/\s+/).filter(Boolean);
					if (!d1 || !d2) return this.replyInThread(ctx, '❌ Use: /report range YYYY-MM-DD YYYY-MM-DD');
					out = await this.reports.getRangeReport(userId, d1, d2);
				} else return this.replyInThread(ctx, '❌ Use: daily | weekly | monthly | range');

				await this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
			} catch (e) {
				this.logger.error('report failed', e as any);
				await this.replyInThread(ctx, '❌ Report error.');
			}
		});

		// /menu — inline menu launches FLOWS (forms)
		this.bot.command('menu', async (ctx) => {
			const threadId = this.getThreadId(ctx);
			await ctx.telegram.sendMessage(ctx.chat!.id, 'Choose an action:', {
				...(threadId ? { message_thread_id: threadId } : {}),
				reply_markup: {
					inline_keyboard: [
						[{ text: '📝 Check-in (manual)', callback_data: 'flow_checkin_manual' }],
						[{ text: '📝 Check-out (manual)', callback_data: 'flow_checkout_manual' }],
						[{ text: '📊 My report (range)', callback_data: 'flow_my_report_range' }],
						[{ text: '👤 User report (range)', callback_data: 'flow_user_report_range' }],
						[{ text: '📅 Status (today)', callback_data: 'do_status' }],
					],
				},
			});
		});

		// ---------- Inline actions (status + start flows) ----------

		this.bot.action('do_status', async (ctx) => {
			try {
				this.logCallback(ctx, 'do_status');
				const s = await this.timeTracking.getTodayStatus(String(ctx.from!.id));
				await ctx.answerCbQuery();
				await this.replyInThread(ctx, s, { parse_mode: 'Markdown' });
			} catch (err) {
				this.logger.error('CB do_status failed:', err);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
				try {
					await this.replyInThread(ctx, '❌ Something went wrong.');
				} catch {}
			}
		});

		// Start manual check-in flow
		this.bot.action('flow_checkin_manual', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_checkin_manual');
				ctx.session.flow = { name: 'checkin_manual', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				await ctx.answerCbQuery();
				await this.replyInThread(ctx, '📅 *Check-in (manual)*\nSend *date* as `YYYY-MM-DD` or type `today`.', {
					parse_mode: 'Markdown',
				});
			} catch (e) {
				this.logger.error('start checkin flow failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
				await this.replyInThread(ctx, '❌ Failed to start flow.');
			}
		});

		// Start manual check-out flow
		this.bot.action('flow_checkout_manual', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_checkout_manual');
				ctx.session.flow = { name: 'checkout_manual', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				await ctx.answerCbQuery();
				await this.replyInThread(ctx, '📅 *Check-out (manual)*\nSend *date* as `YYYY-MM-DD` or type `today`.', {
					parse_mode: 'Markdown',
				});
			} catch (e) {
				this.logger.error('start checkout flow failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
				await this.replyInThread(ctx, '❌ Failed to start flow.');
			}
		});

		// Start my report flow
		this.bot.action('flow_my_report_range', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_my_report_range');
				ctx.session.flow = { name: 'my_report_range', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				await ctx.answerCbQuery();
				await this.replyInThread(ctx, '📊 *My report*\nStart date? `YYYY-MM-DD`', { parse_mode: 'Markdown' });
			} catch (e) {
				this.logger.error('start my report flow failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
				await this.replyInThread(ctx, '❌ Failed to start flow.');
			}
		});

		// Start user report flow
		this.bot.action('flow_user_report_range', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_user_report_range');
				ctx.session.flow = { name: 'user_report_range', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				await ctx.answerCbQuery();
				await this.replyInThread(
					ctx,
					'👤 *User report*\nWho? Reply with *@username*, numeric *ID*, or *reply to their message*.',
					{ parse_mode: 'Markdown' }
				);
			} catch (e) {
				this.logger.error('start user report flow failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
				await this.replyInThread(ctx, '❌ Failed to start flow.');
			}
		});

		// ---------- Flow processor ----------

		this.bot.on('text', async (ctx, next) => {
			const s = ctx.session.flow;
			if (!s) return next();

			const meId = String(ctx.from.id);
			const me = await this.users.findByTelegramId(meId);
			const tz = me?.timezone ?? this.config.get('TIMEZONE') ?? 'Asia/Tehran';

			try {
				// CHECK-IN (manual): date -> time -> save
				if (s.name === 'checkin_manual') {
					if (s.step === 1) {
						const d = this.parseDateOrToday(ctx.message.text, tz);
						if (!d) return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD` or `today`.');
						s.data.date = d;
						s.step = 2;
						return this.replyInThread(ctx, '⏰ Time? `HH:mm` (24h)');
					}
					if (s.step === 2) {
						const t = this.parseHHmm(ctx.message.text);
						if (!t) return this.replyInThread(ctx, '❌ Use `HH:mm` (e.g., 09:15).');
						const ts = this.toUserDate(s.data.date, t.hh, t.mm, tz);
						const r = await this.timeTracking.checkIn(
							meId,
							ts,
							String((ctx.message as any)?.message_id ?? '')
						);
						ctx.session.flow = undefined;
						return this.replyInThread(
							ctx,
							r.success ? `✅ Checked in at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				// CHECK-OUT (manual): date -> time -> save
				if (s.name === 'checkout_manual') {
					if (s.step === 1) {
						const d = this.parseDateOrToday(ctx.message.text, tz);
						if (!d) return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD` or `today`.');
						s.data.date = d;
						s.step = 2;
						return this.replyInThread(ctx, '⏰ Time? `HH:mm` (24h)');
					}
					if (s.step === 2) {
						const t = this.parseHHmm(ctx.message.text);
						if (!t) return this.replyInThread(ctx, '❌ Use `HH:mm` (e.g., 18:05).');
						const ts = this.toUserDate(s.data.date, t.hh, t.mm, tz);
						const r = await this.timeTracking.checkOut(
							meId,
							ts,
							String((ctx.message as any)?.message_id ?? '')
						);
						ctx.session.flow = undefined;
						return this.replyInThread(
							ctx,
							r.success
								? `✅ Checked out at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
								: `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				// MY REPORT (range): start -> end -> report(me)
				if (s.name === 'my_report_range') {
					if (s.step === 1) {
						const d1 = ctx.message.text.trim();
						if (!moment(d1, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						s.data.start = d1;
						s.step = 2;
						return this.replyInThread(ctx, 'End date? `YYYY-MM-DD`');
					}
					if (s.step === 2) {
						const d2 = ctx.message.text.trim();
						if (!moment(d2, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						ctx.session.flow = undefined;
						const out = await this.reports.getRangeReport(meId, s.data.start, d2);
						return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
					}
				}

				// USER REPORT (range): user -> start -> end -> report(that user)
				if (s.name === 'user_report_range') {
					if (s.step === 1) {
						// detect reply first
						const m: any = (ctx as any).message;
						const repliedUserId: string | undefined = m?.reply_to_message?.from?.id
							? String(m.reply_to_message.from.id)
							: undefined;

						let targetId: string | null = null;

						if (repliedUserId) {
							targetId = repliedUserId;
						} else {
							const txt = ctx.message.text.trim();
							if (/^\d+$/.test(txt)) {
								targetId = txt;
							} else if (txt.startsWith('@')) {
								const uname = txt.slice(1);
								const u = await this.users.findByUsername(uname);
								if (u) targetId = u.telegramId;
							}
						}

						if (!targetId) {
							return this.replyInThread(
								ctx,
								'❌ Could not resolve user. Reply to their message, send numeric ID, or @username.'
							);
						}

						s.data.targetId = targetId;
						s.step = 2;
						return this.replyInThread(ctx, 'Start date? `YYYY-MM-DD`');
					}
					if (s.step === 2) {
						const d1 = ctx.message.text.trim();
						if (!moment(d1, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						s.data.start = d1;
						s.step = 3;
						return this.replyInThread(ctx, 'End date? `YYYY-MM-DD`');
					}
					if (s.step === 3) {
						const d2 = ctx.message.text.trim();
						if (!moment(d2, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						const out = await this.reports.getRangeReport(String(s.data.targetId), s.data.start, d2);
						ctx.session.flow = undefined;
						return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
					}
				}
			} catch (err) {
				this.logger.error('Flow error', err as any);
				ctx.session.flow = undefined;
				await this.replyInThread(ctx, '❌ Flow cancelled due to an error.');
			}
		});

		// /cancel
		this.bot.command('cancel', async (ctx) => {
			if (ctx.session.flow) {
				ctx.session.flow = undefined;
				await this.replyInThread(ctx, '❌ Current flow cancelled.');
			} else {
				await this.replyInThread(ctx, 'No active flow.');
			}
		});

		// /help
		this.bot.help(async (ctx) => {
			const help = [
				'🎯 *Time Tracker — Help*',
				'',
				'• /menu — open inline menu (forms)',
				'• /checkin, /checkout — quick actions (now)',
				'• /status — today status',
				'• /report daily|weekly|monthly|range YYYY-MM-DD YYYY-MM-DD',
				'• /cancel — cancel current form',
				'',
				'Tips:',
				'• Run these in the desired *topic* so replies stay organized.',
				'• For *User report*, you can *reply* to their message in the topic.',
			].join('\n');
			await this.replyInThread(ctx, help, { parse_mode: 'Markdown' });
		});

		// Global error
		this.bot.catch((err, ctx) => {
			this.logger.error(`Bot error for ${ctx.updateType}:`, err as any);
			try {
				this.replyInThread(ctx as any, '❌ Something went wrong.');
			} catch {}
		});
	}
}
