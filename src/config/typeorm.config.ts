import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import { TimeEntry } from '../entities/time-entry.entity';
import { WorkSession } from '../entities/work-session.entity';

const configService = new ConfigService();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: configService.get('DATABASE_URL') || process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  entities: [User, TimeEntry, WorkSession],
  migrations: ['dist/migrations/*.js'],
  synchronize: process.env.NODE_ENV !== 'production', // Only for development
  logging: process.env.NODE_ENV === 'development',
});