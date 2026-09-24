import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController, AuthGuard } from './auth/auth.js';
import { Database } from './database/database.js';
import { AssignmentsController } from './assignments/assignments.controller.js';
import { AssignmentsService } from './assignments/assignments.service.js';
import { ClassesController, ClassesService } from './classes/classes.js';

@Controller('health')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get() async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
  controllers: [AuthController, AssignmentsController, ClassesController, HealthController],
  providers: [
    Database,
    AuthGuard,
    AssignmentsService,
    ClassesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
