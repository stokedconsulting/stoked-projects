import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class HealthService {
  constructor(@InjectConnection() private connection: Connection) {}

  async check() {
    const dbStatus = this.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
    };
  }

  async ready() {
    const isReady = this.connection.readyState === 1;
    
    return {
      ready: isReady,
      timestamp: new Date().toISOString(),
    };
  }
}
