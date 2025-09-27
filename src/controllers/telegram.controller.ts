import { Controller, Post, Body, Logger } from '@nestjs/common';
import { TelegramService } from '../services/telegram.service';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private telegramService: TelegramService) {}

  @Post('webhook')
  async webhook(@Body() update: any) {
    this.logger.log('Received webhook update:', JSON.stringify(update, null, 2));
    
    try {
      await this.telegramService.handleUpdate(update);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Webhook error:', error);
      return { status: 'error', message: error.message };
    }
  }
}