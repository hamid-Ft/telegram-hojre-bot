import { Controller, Post, Body, Logger, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from '../services/telegram.service';

@Controller('telegram')
export class TelegramController {
	private readonly logger = new Logger(TelegramController.name);

	constructor(
		private readonly telegramService: TelegramService,
		private readonly config: ConfigService
	) {}

	@Post('webhook')
	async webhook(@Headers('x-telegram-bot-api-secret-token') token: string, @Body() update: any) {
		const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
		if (expected && token !== expected) {
			this.logger.warn('Invalid webhook secret');
			return { status: 'forbidden' };
		}
		await this.telegramService.handleUpdate(update);
		return { status: 'ok' };
	}
}
