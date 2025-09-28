import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService {
	constructor(@InjectRepository(User) private userRepository: Repository<User>) {}

	async createOrUpdateUser(telegramUser: any): Promise<User> {
		const existingUser = await this.userRepository.findOne({
			where: { telegramId: telegramUser.id.toString() },
		});

		if (existingUser) {
			existingUser.username = telegramUser.username || null;
			existingUser.firstName = telegramUser.first_name || null;
			existingUser.lastName = telegramUser.last_name || null;
			return await this.userRepository.save(existingUser);
		}

		const newUser = this.userRepository.create({
			telegramId: telegramUser.id.toString(),
			username: telegramUser.username || null,
			firstName: telegramUser.first_name || null,
			lastName: telegramUser.last_name || null,
			timezone: 'Asia/Tehran',
			isActive: true,
		});

		return await this.userRepository.save(newUser);
	}

	async findByTelegramId(telegramId: string): Promise<User | null> {
		return await this.userRepository.findOne({ where: { telegramId } });
	}

	async findByUsername(username: string): Promise<User | null> {
		// Case-insensitive; stored usernames do not include '@'
		return await this.userRepository.findOne({
			where: { username: ILike(username) },
		});
	}

	async updateTimezone(telegramId: string, timezone: string): Promise<User> {
		const user = await this.findByTelegramId(telegramId);
		if (!user) throw new Error('User not found');
		user.timezone = timezone;
		return await this.userRepository.save(user);
	}

	async getAllActiveUsers(): Promise<User[]> {
		return await this.userRepository.find({ where: { isActive: true } });
	}

	async deactivateUser(telegramId: string): Promise<User> {
		const user = await this.findByTelegramId(telegramId);
		if (!user) throw new Error('User not found');
		user.isActive = false;
		return await this.userRepository.save(user);
	}
}
