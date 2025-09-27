import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { TimeEntry } from './time-entry.entity';
import { WorkSession } from './work-session.entity';

@Entity('users')
export class User {
  @PrimaryColumn('bigint')
  telegramId: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ default: 'Asia/Tehran' })
  timezone: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TimeEntry, (entry) => entry.user)
  timeEntries: TimeEntry[];

  @OneToMany(() => WorkSession, (session) => session.user)
  workSessions: WorkSession[];
}