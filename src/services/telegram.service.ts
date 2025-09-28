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
		private userService: UserService
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
			// No secret token since you asked to omit it
			await this.bot.telegram.setWebhook(webhookUrl /*, { drop_pending_updates: true }*/);
			this.logger.log(`Webhook set to: ${webhookUrl}`);
		} else {
			this.logger.warn('TELEGRAM_WEBHOOK_URL is not set; webhook not configured.');
		}
	}

	/** Extract current topic/thread id from any update type */
	private getThreadId(ctx: TelegramContext): number | undefined {
		const m: any = (ctx as any).message ?? (ctx as any).callbackQuery?.message;
		return m?.message_thread_id as number | undefined;
	}

	/** Reply inside the same topic/thread (or fallback to normal reply) */
	private async replyInThread(
		ctx: TelegramContext,
		text: string,
		extra: Parameters<Telegraf<TelegramContext>['telegram']['sendMessage']>[2] = {}
	) {
		const chatId = ctx.chat!.id;
		const threadId = this.getThreadId(ctx);
		const options = { ...extra, ...(threadId ? { message_thread_id: threadId } : {}) };
		return ctx.telegram.sendMessage(chatId, text, options);
	}

	private setupCommands() {
		// /start (works anywhere; in groups it won’t DM unless user opens bot)
		this.bot.start(async (ctx) => {
			await this.userService.createOrUpdateUser(ctx.from);
			const welcomeMessage = `
🎯 *Welcome to Time Tracker Bot!*

Available commands:
📍 /checkin — Record your arrival time
📤 /checkout — Record your departure time
📊 /status — View today's work status
📈 /report daily — Today's work summary
📈 /report weekly — This week's summary
📈 /report monthly — This month's summary
📈 /report range YYYY-MM-DD YYYY-MM-DD — Custom date range
⚙️ /settings — Configure your preferences
❓ /help — Show this help message

Let's start tracking your work hours! 🚀
      `;
			await this.replyInThread(ctx, welcomeMessage, { parse_mode: 'Markdown' });
		});

		// /checkin
		this.bot.command('checkin', async (ctx) => {
			try {
				const user = ctx.from;
				await this.userService.createOrUpdateUser(user);

				const result = await this.timeTrackingService.checkIn(
					String(user.id),
					new Date(),
					String((ctx.message as any)?.message_id ?? '')
				);

				if (result.success) {
					await this.replyInThread(
						ctx,
						`✅ *Checked in successfully!*\n\n🕐 Time: ${result.formattedTime}\n📅 Date: ${result.date}\n\nHave a productive day! 💪`,
						{ parse_mode: 'Markdown' }
					);
				} else {
					await this.replyInThread(ctx, `❌ ${result.message}`, { parse_mode: 'Markdown' });
				}
			} catch (error) {
				this.logger.error('Check-in error:', error);
				await this.replyInThread(ctx, '❌ An error occurred during check-in. Please try again.');
			}
		});

		// /checkout
		this.bot.command('checkout', async (ctx) => {
			try {
				const user = ctx.from;
				const result = await this.timeTrackingService.checkOut(
					String(user.id),
					new Date(),
					String((ctx.message as any)?.message_id ?? '')
				);

				if (result.success) {
					await this.replyInThread(
						ctx,
						`✅ *Checked out successfully!*\n\n🕐 Time: ${result.formattedTime}\n📅 Date: ${result.date}\n⏱️ Total hours today: ${result.totalHours}\n\nGreat work today! 🎉`,
						{ parse_mode: 'Markdown' }
					);
				} else {
					await this.replyInThread(ctx, `❌ ${result.message}`, { parse_mode: 'Markdown' });
				}
			} catch (error) {
				this.logger.error('Check-out error:', error);
				await this.replyInThread(ctx, '❌ An error occurred during check-out. Please try again.');
			}
		});

		// /status
		this.bot.command('status', async (ctx) => {
			try {
				const status = await this.timeTrackingService.getTodayStatus(String(ctx.from.id));
				await this.replyInThread(ctx, status, { parse_mode: 'Markdown' });
			} catch (error) {
				this.logger.error('Status error:', error);
				await this.replyInThread(ctx, '❌ An error occurred while fetching status.');
			}
		});

		// /report ...
		this.bot.hears(/^\/report\s+(\w+)(.*)/, async (ctx) => {
			try {
				const match = ctx.match!;
				const reportType = match[1];
				const params = match[2]?.trim();

				let report: string;
				const userId = String(ctx.from.id);

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
					case 'range': {
						const dates = params?.split(' ').filter(Boolean);
						if (!dates || dates.length !== 2) {
							await this.replyInThread(
								ctx,
								'❌ Please provide start and end dates in format: /report range YYYY-MM-DD YYYY-MM-DD'
							);
							return;
						}
						report = await this.reportService.getRangeReport(userId, dates[0], dates[1]);
						break;
					}
					default:
						await this.replyInThread(ctx, '❌ Invalid report type. Use: daily, weekly, monthly, or range');
						return;
				}

				await this.replyInThread(ctx, report, { parse_mode: 'Markdown' });
			} catch (error) {
				this.logger.error('Report error:', error);
				await this.replyInThread(ctx, '❌ An error occurred while generating the report.');
			}
		});

		// /menu (posts inline buttons into the *current* topic)
		this.bot.command('menu', async (ctx) => {
			const threadId = this.getThreadId(ctx);
			await ctx.telegram.sendMessage(ctx.chat!.id, 'Choose an action:', {
				...(threadId ? { message_thread_id: threadId } : {}),
				reply_markup: {
					inline_keyboard: [
						[{ text: 'Check-in', callback_data: 'do_checkin' }],
						[{ text: 'Check-out', callback_data: 'do_checkout' }],
						[{ text: 'Status', callback_data: 'do_status' }],
						[{ text: 'Report (today)', callback_data: 'do_report_daily' }],
					],
				},
			});
		});

		// Inline button callbacks (stay in same topic)
		this.bot.on('callback_query', async (ctx) => {
			const data = (ctx.callbackQuery as any)?.data as string | undefined;
			const chatId = ctx.chat!.id;
			const threadId = this.getThreadId(ctx);
			const from = ctx.from!;
			const userId = String(from.id);

			try {
				switch (data) {
					case 'do_checkin': {
						const r = await this.timeTrackingService.checkIn(
							userId,
							new Date(),
							String((ctx.callbackQuery as any).id)
						);
						await ctx.telegram.sendMessage(
							chatId,
							r.success ? `✅ Checked in at ${r.formattedTime}` : `❌ ${r.message}`,
							{ ...(threadId ? { message_thread_id: threadId } : {}) }
						);
						break;
					}
					case 'do_checkout': {
						const r = await this.timeTrackingService.checkOut(
							userId,
							new Date(),
							String((ctx.callbackQuery as any).id)
						);
						await ctx.telegram.sendMessage(
							chatId,
							r.success
								? `✅ Checked out at ${r.formattedTime}\n⏱️ Today: ${r.totalHours}`
								: `❌ ${r.message}`,
							{ ...(threadId ? { message_thread_id: threadId } : {}) }
						);
						break;
					}
					case 'do_status': {
						const s = await this.timeTrackingService.getTodayStatus(userId);
						await ctx.telegram.sendMessage(chatId, s, {
							...(threadId ? { message_thread_id: threadId } : {}),
							parse_mode: 'Markdown',
						});
						break;
					}
					case 'do_report_daily': {
						const rep = await this.reportService.getDailyReport(userId);
						await ctx.telegram.sendMessage(chatId, rep, {
							...(threadId ? { message_thread_id: threadId } : {}),
							parse_mode: 'Markdown',
						});
						break;
					}
				}
				await ctx.answerCbQuery();
			} catch (e) {
				await ctx.answerCbQuery('Error');
			}
		});

		// /help
		this.bot.help(async (ctx) => {
			const helpMessage = `
🎯 *Time Tracker Bot — Help*

*Basic Commands:*
📍 /checkin — Record your arrival time
📤 /checkout — Record your departure time
📊 /status — View today's work status

*Reports:*
📈 /report daily — Today's work summary
📈 /report weekly — This week's summary
📈 /report monthly — This month's summary
📈 /report range 2024-01-01 2024-01-31 — Custom date range

*Other Commands:*
⚙️ /settings — Configure timezone and preferences
❓ /help — Show this help message
/here — Show current chat/thread details

*Tips:*
• Use *inline menu* via /menu to keep everything inside this topic.
• In groups with privacy ON, use commands like */checkin@Hojre_Gardun_Bot*.
      `;
			await this.replyInThread(ctx, helpMessage, { parse_mode: 'Markdown' });
		});

		// /here — echo chat & thread ids to bind your bot if needed
		this.bot.command('here', async (ctx) => {
			const chat = ctx.chat;
			const m: any = (ctx as any).message;
			const threadId = m?.message_thread_id;
			await this.replyInThread(
				ctx,
				[
					`chat.id: ${chat?.id}`,
					`chat.type: ${chat?.type}`,
					`is_topic_message: ${m?.is_topic_message ? 'true' : 'false'}`,
					`message_thread_id: ${threadId ?? 'none'}`,
				].join('\n')
			);
		});

		// Global error handler
		this.bot.catch((err, ctx) => {
			this.logger.error(`Bot error for ${ctx.updateType}:`, err as any);
			// Avoid recursion if replying fails in webhook context
			try {
				this.replyInThread(ctx, '❌ Something went wrong. Please try again later.');
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
