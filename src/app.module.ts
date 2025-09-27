import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

// Entities
import { User } from './entities/user.entity';
import { TimeEntry } from './entities/time-entry.entity';
import { WorkSession } from './entities/work-session.entity';

// Services
import { TelegramService } from './services/telegram.service';
import { UserService } from './services/user.service';
import { TimeTrackingService } from './services/time-tracking.service';
import { ReportService } from './services/report.service';
import { SchedulerService } from './services/scheduler.service';

// Controllers
import { AppController } from './app.controller';
import { TelegramController } from './controllers/telegram.controller';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
        entities: [User, TimeEntry, WorkSession],
        synchronize: process.env.NODE_ENV !== 'production',
        logging: process.env.NODE_ENV === 'development',
      }),
    }),

    // Entity repositories
    TypeOrmModule.forFeature([User, TimeEntry, WorkSession]),

    // Scheduling
    ScheduleModule.forRoot(),
  ],

  controllers: [AppController, TelegramController],
  providers: [
    TelegramService,
    UserService,
    TimeTrackingService,
    ReportService,
    SchedulerService,
  ],
})
export class AppModule {}