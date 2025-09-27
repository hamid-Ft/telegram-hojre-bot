import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum EntryType {
  CHECK_IN = 'check_in',
  CHECK_OUT = 'check_out',
}

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('bigint')
  telegramId: string;

  @Column({
    type: 'enum',
    enum: EntryType,
  })
  type: EntryType;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ nullable: true })
  note: string;

  @Column({ nullable: true })
  messageId: string;

  @Column({ nullable: true })
  topicId: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.timeEntries)
  @JoinColumn({ name: 'telegramId', referencedColumnName: 'telegramId' })
  user: User;
}