import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      message: 'Telegram Time Tracker Bot is running!',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  getHealthCheck() {
    return {
      status: 'healthy',
      service: 'telegram-timetrack-bot',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}