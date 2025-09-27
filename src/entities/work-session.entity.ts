import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('work_sessions')
@Index(['telegramId', 'date'], { unique: true })
export class WorkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('bigint')
  telegramId: string;

  @Column({ type: 'date' })
  date: string; // Format: YYYY-MM-DD

  @Column({ type: 'timestamp', nullable: true })
  checkIn: Date;

  @Column({ type: 'timestamp', nullable: true })
  checkOut: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalHours: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  breakMinutes: number;

  @Column({ type: 'json', nullable: true })
  breaks: Array<{
    start: Date;
    end: Date;
    duration: number; // minutes
  }>;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.workSessions)
  @JoinColumn({ name: 'telegramId', referencedColumnName: 'telegramId' })
  user: User;
}