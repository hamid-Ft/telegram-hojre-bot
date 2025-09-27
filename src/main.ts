import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule);
  
  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  // Enable CORS for frontend if needed
  app.enableCors();

  const port = process.env.PORT || 3000;
  
  await app.listen(port);
  
  logger.log(`🚀 Telegram Time Tracker Bot is running on port ${port}`);
  logger.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  logger.log(`🤖 Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
  logger.log(`🔗 Webhook: ${process.env.TELEGRAM_WEBHOOK_URL || 'Not set'}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start the application:', error);
  process.exit(1);
});