import { Context, Telegraf } from 'telegraf';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Markup } from 'telegraf';
import * as moment from 'moment-timezone'; // you already import this
import { ReportService } from './report.service';
import { TimeTrackingService } from './time-tracking.service';
import { UserService } from './user.service';

type FlowName =
	| 'checkin_manual'
	| 'checkout_manual'
	| 'my_report_range'
	| 'user_report_range'
	| 'checkin_form'
	| 'checkout_form'
	| 'report_range_form';

interface FlowState {
	name: FlowName;
	step: number;
	data: Record<string, any>;
	threadId?: number;
}

interface TelegramContext extends Context {
	match?: RegExpExecArray | null;
}

@Injectable()
export class TelegramService implements OnModuleInit {
	private readonly logger = new Logger(TelegramService.name);
	private bot: Telegraf<TelegramContext>;

	// Simple in-memory flow store: chatId:userId:threadId -> FlowState
	private flows = new Map<string, FlowState>();

	constructor(
		private config: ConfigService,
		private timeTracking: TimeTrackingService,
		private reports: ReportService,
		private users: UserService
	) {
		const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
		if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

		this.bot = new Telegraf<TelegramContext>(token);
		this.setupCommandsAndFlows();
	}

	async onModuleInit() {
		const webhookUrl = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
		const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');

		if (webhookUrl) {
			await this.bot.telegram.setWebhook(webhookUrl, secret ? { secret_token: secret } : undefined);
			this.logger.log(`Webhook set to: ${webhookUrl}`);
		} else {
			await this.bot.launch();
			this.logger.warn('No TELEGRAM_WEBHOOK_URL set — using long-polling for dev.');
		}
	}

	getBotInstance() {
		return this.bot;
	}

	async handleUpdate(update: any) {
		return this.bot.handleUpdate(update);
	}

	// ---------- helpers ----------

	private getThreadId(ctx: TelegramContext): number | undefined {
		const m: any = (ctx as any).message ?? (ctx as any).callbackQuery?.message;
		return m?.message_thread_id as number | undefined;
	}

	private getKey(ctx: TelegramContext): string {
		const chatId = ctx.chat?.id ?? 0;
		const userId = ctx.from?.id ?? 0;
		const threadId = this.getThreadId(ctx) ?? 0;
		return `${chatId}:${userId}:${threadId}`;
	}

	private getFlow(ctx: TelegramContext): FlowState | undefined {
		return this.flows.get(this.getKey(ctx));
	}

	private setFlow(ctx: TelegramContext, flow: FlowState | undefined) {
		const key = this.getKey(ctx);
		if (flow) this.flows.set(key, flow);
		else this.flows.delete(key);
	}

	private async replyInThread(
		ctx: TelegramContext,
		text: string,
		extra: Parameters<Telegraf<TelegramContext>['telegram']['sendMessage']>[2] = {}
	) {
		const chatId = ctx.chat!.id;
		const threadId = this.getThreadId(ctx) ?? this.getFlow(ctx)?.threadId;
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

	private parseDateOrToday(s: string, tz: string): string | null {
		const t = s.trim().toLowerCase();
		if (t === 'today') return moment.tz(tz).format('YYYY-MM-DD');
		if (!moment(t, 'YYYY-MM-DD', true).isValid()) return null;
		return t;
	}

	private parseHHmm(s: string): { hh: number; mm: number } | null {
		const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
		if (!m) return null;
		return { hh: parseInt(m[1], 10), mm: parseInt(m[2], 10) };
	}

	private toUserDate(dateStr: string, hh: number, mm: number, tz: string): Date {
		return moment.tz(dateStr, 'YYYY-MM-DD', tz).hour(hh).minute(mm).second(0).millisecond(0).toDate();
	}

	// ---------- commands, menu & flows ----------
	private buildCalendarKeyboard(cursorISO: string) {
		const cursor = moment(cursorISO, 'YYYY-MM-DD');
		const year = cursor.year();
		const month = cursor.month(); // 0..11

		// First day of month and number of days
		const startOfMonth = cursor.clone().startOf('month');
		const endOfMonth = cursor.clone().endOf('month');
		const daysInMonth = endOfMonth.date();

		// Determine leading empty cells (ISO week: Monday=1,...Sunday=7). We’ll use Monday-first layout.
		const firstWeekday = (startOfMonth.isoWeekday() + 6) % 7; // 0..6 -> Monday..Sunday => 0..6
		const rows: any[] = [];

		// Header with month navigation
		const prevMonth = cursor.clone().subtract(1, 'month').format('YYYY-MM-DD');
		const nextMonth = cursor.clone().add(1, 'month').format('YYYY-MM-DD');
		rows.push([
			{ text: '«', callback_data: `cal_nav:${prevMonth}` },
			{ text: cursor.format('MMMM YYYY'), callback_data: 'noop' },
			{ text: '»', callback_data: `cal_nav:${nextMonth}` },
		]);

		// Weekday header
		rows.push([
			{ text: 'Mo', callback_data: 'noop' },
			{ text: 'Tu', callback_data: 'noop' },
			{ text: 'We', callback_data: 'noop' },
			{ text: 'Th', callback_data: 'noop' },
			{ text: 'Fr', callback_data: 'noop' },
			{ text: 'Sa', callback_data: 'noop' },
			{ text: 'Su', callback_data: 'noop' },
		]);

		const buttons: any[] = [];
		for (let i = 0; i < firstWeekday; i++) {
			buttons.push({ text: ' ', callback_data: 'noop' });
		}
		for (let d = 1; d <= daysInMonth; d++) {
			const dateStr = cursor.clone().date(d).format('YYYY-MM-DD');
			buttons.push({ text: String(d), callback_data: `cal_pick:${dateStr}` });
		}
		// pad tail to full rows of 7
		while (buttons.length % 7 !== 0) {
			buttons.push({ text: ' ', callback_data: 'noop' });
		}
		// chunk in rows of 7
		for (let i = 0; i < buttons.length; i += 7) {
			rows.push(buttons.slice(i, i + 7));
		}

		// Footer cancel
		rows.push([{ text: '✖ Cancel', callback_data: 'cal_cancel' }]);

		return { inline_keyboard: rows };
	}

	/** Build a time picker (HH:mm) keyboard at a given minute step. Default 15 minutes, business hours 07:00..21:45 */
	private buildTimeKeyboard(stepMinutes = 15, from = 7, to = 22) {
		const rows: any[] = [];
		const times: string[] = [];
		for (let h = from; h < to; h++) {
			for (let m = 0; m < 60; m += stepMinutes) {
				times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
			}
		}
		// 4 per row looks nice
		for (let i = 0; i < times.length; i += 4) {
			const chunk = times.slice(i, i + 4).map((t) => ({ text: t, callback_data: `time_pick:${t}` }));
			rows.push(chunk);
		}
		rows.push([{ text: '✖ Cancel', callback_data: 'time_cancel' }]);

		return { inline_keyboard: rows };
	}

	private async askForDate(ctx: TelegramContext, title: string, cursorISO?: string) {
		const tz =
			(await this.users.findByTelegramId(String(ctx.from!.id)))?.timezone ??
			this.config.get('TIMEZONE') ??
			'Asia/Tehran';
		const todayISO = moment.tz(tz).format('YYYY-MM-DD');
		const keyboard = this.buildCalendarKeyboard(cursorISO || todayISO);
		return this.replyInThread(ctx, `${title}\n\nانتخاب تاریخ:`, { reply_markup: keyboard });
	}

	private async askForTime(ctx: TelegramContext, title: string) {
		const keyboard = this.buildTimeKeyboard(15, 7, 22);
		return this.replyInThread(ctx, `${title}\n\nانتخاب ساعت:`, { reply_markup: keyboard });
	}
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

		// Quick now checkin/checkout
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

		// /menu — inline menu launches flows
		this.bot.command('menu', async (ctx) => {
			const threadId = this.getThreadId(ctx);
			await ctx.telegram.sendMessage(ctx.chat!.id, 'Choose an action:', {
				...(threadId ? { message_thread_id: threadId } : {}),
				reply_markup: {
					inline_keyboard: [
						// NEW: “real-feeling” forms (inline keyboards)
						[{ text: '🗓️ Check-in (form)', callback_data: 'form_checkin' }],
						[{ text: '🗓️ Check-out (form)', callback_data: 'form_checkout' }],
						[{ text: '📅 Report (range form)', callback_data: 'form_report_range' }],
						// Existing quick / forms
						[{ text: '📝 Check-in (manual text)', callback_data: 'flow_checkin_manual' }],
						[{ text: '📝 Check-out (manual text)', callback_data: 'flow_checkout_manual' }],
						[{ text: '📊 My report (range - text)', callback_data: 'flow_my_report_range' }],
						[{ text: '👤 User report (range - text)', callback_data: 'flow_user_report_range' }],
						[{ text: '📅 Status (today)', callback_data: 'do_status' }],
					],
				},
			});
		});

		// --- Inline actions (status + start flows)

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

		this.bot.action('flow_checkin_manual', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_checkin_manual');
				const flow: FlowState = { name: 'checkin_manual', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				this.setFlow(ctx, flow);
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

		this.bot.action('flow_checkout_manual', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_checkout_manual');
				const flow: FlowState = { name: 'checkout_manual', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				this.setFlow(ctx, flow);
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

		this.bot.action('flow_my_report_range', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_my_report_range');
				const flow: FlowState = { name: 'my_report_range', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				this.setFlow(ctx, flow);
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

		this.bot.action('flow_user_report_range', async (ctx) => {
			try {
				this.logCallback(ctx, 'flow_user_report_range');
				const flow: FlowState = {
					name: 'user_report_range',
					step: 1,
					data: {},
					threadId: this.getThreadId(ctx),
				};
				this.setFlow(ctx, flow);
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

		// === Start inline-UI flows ===
		this.bot.action('form_checkin', async (ctx) => {
			try {
				this.logCallback(ctx, 'form_checkin');
				const tz =
					(await this.users.findByTelegramId(String(ctx.from!.id)))?.timezone ??
					this.config.get('TIMEZONE') ??
					'Asia/Tehran';
				const today = moment.tz(tz).format('YYYY-MM-DD');
				const flow: FlowState = { name: 'checkin_form', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				this.setFlow(ctx, flow);
				await ctx.answerCbQuery();
				await this.askForDate(ctx, '✅ Check-in (form)', today);
			} catch (e) {
				this.logger.error('start checkin form failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
			}
		});

		this.bot.action('form_checkout', async (ctx) => {
			try {
				this.logCallback(ctx, 'form_checkout');
				const tz =
					(await this.users.findByTelegramId(String(ctx.from!.id)))?.timezone ??
					this.config.get('TIMEZONE') ??
					'Asia/Tehran';
				const today = moment.tz(tz).format('YYYY-MM-DD');
				const flow: FlowState = { name: 'checkout_form', step: 1, data: {}, threadId: this.getThreadId(ctx) };
				this.setFlow(ctx, flow);
				await ctx.answerCbQuery();
				await this.askForDate(ctx, '✅ Check-out (form)', today);
			} catch (e) {
				this.logger.error('start checkout form failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
			}
		});

		this.bot.action('form_report_range', async (ctx) => {
			try {
				this.logCallback(ctx, 'form_report_range');
				const tz =
					(await this.users.findByTelegramId(String(ctx.from!.id)))?.timezone ??
					this.config.get('TIMEZONE') ??
					'Asia/Tehran';
				const today = moment.tz(tz).format('YYYY-MM-DD');
				const flow: FlowState = {
					name: 'report_range_form',
					step: 1,
					data: {},
					threadId: this.getThreadId(ctx),
				};
				this.setFlow(ctx, flow);
				await ctx.answerCbQuery();
				await this.askForDate(ctx, '📊 Report (range) — Start date', today);
			} catch (e) {
				this.logger.error('start report form failed', e as any);
				try {
					await ctx.answerCbQuery('Error');
				} catch {}
			}
		});

		// === Inline calendar navigation
		this.bot.action(/cal_nav:(.+)/, async (ctx) => {
			try {
				const target = ctx.match![1]; // YYYY-MM-DD
				await ctx.answerCbQuery();
				// edit the last calendar message if possible; else send a new one
				await this.replyInThread(ctx, 'انتخاب تاریخ:', {
					reply_markup: this.buildCalendarKeyboard(target),
				});
			} catch (e) {
				this.logger.error('cal_nav error', e as any);
			}
		});

		this.bot.action(/cal_pick:(\d{4}-\d{2}-\d{2})/, async (ctx) => {
			try {
				await ctx.answerCbQuery();
				const flow = this.getFlow(ctx);
				if (!flow) return this.replyInThread(ctx, '❌ No active form. Use /menu');

				const pickedDate = ctx.match![1]; // YYYY-MM-DD
				if (flow.name === 'report_range_form') {
					if (flow.step === 1) {
						flow.data.start = pickedDate;
						flow.step = 2;
						this.setFlow(ctx, flow);
						return this.askForDate(ctx, '📊 Report (range) — End date', pickedDate);
					} else if (flow.step === 2) {
						flow.data.end = pickedDate;
						this.setFlow(ctx, undefined);
						const meId = String(ctx.from!.id);
						const out = await this.reports.getRangeReport(meId, flow.data.start, flow.data.end);
						return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
					}
				}

				// checkin/checkout forms
				flow.data.date = pickedDate;
				flow.step = 2;
				this.setFlow(ctx, flow);
				return this.askForTime(
					ctx,
					flow.name === 'checkin_form' ? '✅ Check-in — انتخاب ساعت' : '✅ Check-out — انتخاب ساعت'
				);
			} catch (e) {
				this.logger.error('cal_pick error', e as any);
			}
		});

		this.bot.action('cal_cancel', async (ctx) => {
			try {
				await ctx.answerCbQuery('Cancelled');
			} catch {}
			if (this.getFlow(ctx)) this.setFlow(ctx, undefined);
			await this.replyInThread(ctx, '❌ Form cancelled.');
		});

		// === Inline time picker
		this.bot.action(/time_pick:(\d{2}:\d{2})/, async (ctx) => {
			try {
				await ctx.answerCbQuery();
				const flow = this.getFlow(ctx);
				if (!flow) return this.replyInThread(ctx, '❌ No active form. Use /menu');

				const pickedTime = ctx.match![1]; // HH:mm
				const [hh, mm] = pickedTime.split(':').map(Number);
				const meId = String(ctx.from!.id);
				const me = await this.users.findByTelegramId(meId);
				const tz = me?.timezone ?? this.config.get('TIMEZONE') ?? 'Asia/Tehran';

				if (!flow.data?.date) {
					// Should not happen, but guard anyway
					return this.replyInThread(ctx, '❌ Pick a date first.');
				}

				const ts = this.toUserDate(flow.data.date, hh, mm, tz);

				if (flow.name === 'checkin_form') {
					const r = await this.timeTracking.checkIn(meId, ts);
					this.setFlow(ctx, undefined);
					return this.replyInThread(
						ctx,
						r.success ? `✅ Checked in at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
						{ parse_mode: 'Markdown' }
					);
				}

				if (flow.name === 'checkout_form') {
					const r = await this.timeTracking.checkOut(meId, ts);
					this.setFlow(ctx, undefined);
					return this.replyInThread(
						ctx,
						r.success
							? `✅ Checked out at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
							: `❌ ${r.message}`,
						{ parse_mode: 'Markdown' }
					);
				}

				return this.replyInThread(ctx, '❌ Unexpected flow. Use /menu');
			} catch (e) {
				this.logger.error('time_pick error', e as any);
			}
		});

		this.bot.action('time_cancel', async (ctx) => {
			try {
				await ctx.answerCbQuery('Cancelled');
			} catch {}
			if (this.getFlow(ctx)) this.setFlow(ctx, undefined);
			await this.replyInThread(ctx, '❌ Form cancelled.');
		});

		// Prevent “noop” buttons from showing errors
		this.bot.action('noop', async (ctx) => {
			try {
				await ctx.answerCbQuery();
			} catch {}
		});

		// ---------- Flow processor (text messages) ----------

		this.bot.on('text', async (ctx, next) => {
			const flow = this.getFlow(ctx);
			if (!flow) return next();

			const meId = String(ctx.from!.id);
			const me = await this.users.findByTelegramId(meId);
			const tz = me?.timezone ?? this.config.get('TIMEZONE') ?? 'Asia/Tehran';

			try {
				if (flow.name === 'checkin_manual') {
					if (flow.step === 1) {
						const d = this.parseDateOrToday(ctx.message.text, tz);
						if (!d) return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD` or `today`.');
						flow.data.date = d;
						flow.step = 2;
						this.setFlow(ctx, flow);
						return this.replyInThread(ctx, '⏰ Time? `HH:mm` (24h)');
					}
					if (flow.step === 2) {
						const t = this.parseHHmm(ctx.message.text);
						if (!t) return this.replyInThread(ctx, '❌ Use `HH:mm` (e.g., 09:15).');
						const ts = this.toUserDate(flow.data.date, t.hh, t.mm, tz);
						const r = await this.timeTracking.checkIn(
							meId,
							ts,
							String((ctx.message as any)?.message_id ?? '')
						);
						this.setFlow(ctx, undefined);
						return this.replyInThread(
							ctx,
							r.success ? `✅ Checked in at ${r.formattedTime} (${r.date})` : `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				if (flow.name === 'checkout_manual') {
					if (flow.step === 1) {
						const d = this.parseDateOrToday(ctx.message.text, tz);
						if (!d) return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD` or `today`.');
						flow.data.date = d;
						flow.step = 2;
						this.setFlow(ctx, flow);
						return this.replyInThread(ctx, '⏰ Time? `HH:mm` (24h)');
					}
					if (flow.step === 2) {
						const t = this.parseHHmm(ctx.message.text);
						if (!t) return this.replyInThread(ctx, '❌ Use `HH:mm` (e.g., 18:05).');
						const ts = this.toUserDate(flow.data.date, t.hh, t.mm, tz);
						const r = await this.timeTracking.checkOut(
							meId,
							ts,
							String((ctx.message as any)?.message_id ?? '')
						);
						this.setFlow(ctx, undefined);
						return this.replyInThread(
							ctx,
							r.success
								? `✅ Checked out at ${r.formattedTime} (${r.date})\n⏱️ Today: ${r.totalHours} h`
								: `❌ ${r.message}`,
							{ parse_mode: 'Markdown' }
						);
					}
				}

				if (flow.name === 'my_report_range') {
					if (flow.step === 1) {
						const d1 = ctx.message.text.trim();
						if (!moment(d1, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						flow.data.start = d1;
						flow.step = 2;
						this.setFlow(ctx, flow);
						return this.replyInThread(ctx, 'End date? `YYYY-MM-DD`');
					}
					if (flow.step === 2) {
						const d2 = ctx.message.text.trim();
						if (!moment(d2, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						this.setFlow(ctx, undefined);
						const out = await this.reports.getRangeReport(meId, flow.data.start, d2);
						return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
					}
				}

				if (flow.name === 'user_report_range') {
					if (flow.step === 1) {
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

						flow.data.targetId = targetId;
						flow.step = 2;
						this.setFlow(ctx, flow);
						return this.replyInThread(ctx, 'Start date? `YYYY-MM-DD`');
					}
					if (flow.step === 2) {
						const d1 = ctx.message.text.trim();
						if (!moment(d1, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						flow.data.start = d1;
						flow.step = 3;
						this.setFlow(ctx, flow);
						return this.replyInThread(ctx, 'End date? `YYYY-MM-DD`');
					}
					if (flow.step === 3) {
						const d2 = ctx.message.text.trim();
						if (!moment(d2, 'YYYY-MM-DD', true).isValid())
							return this.replyInThread(ctx, '❌ Use `YYYY-MM-DD`.');
						const out = await this.reports.getRangeReport(String(flow.data.targetId), flow.data.start, d2);
						this.setFlow(ctx, undefined);
						return this.replyInThread(ctx, out, { parse_mode: 'Markdown' });
					}
				}
			} catch (err) {
				this.logger.error('Flow error', err as any);
				this.setFlow(ctx, undefined);
				await this.replyInThread(ctx, '❌ Flow cancelled due to an error.');
			}
		});

		// /cancel
		this.bot.command('cancel', async (ctx) => {
			if (this.getFlow(ctx)) {
				this.setFlow(ctx, undefined);
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
