import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController, AuthGuard } from './auth/auth.js';
import { Database } from './database/database.js';
import { AssignmentsController } from './assignments/assignments.controller.js';
import { AssignmentsService } from './assignments/assignments.service.js';
import { MultiTypeService } from './assignments/multi-type.service.js';
import { ClassesController, ClassesService } from './classes/classes.js';
import { AssetsController } from './assets/assets.controller.js';
import { AssetsService } from './assets/assets.service.js';

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
  controllers: [
    AuthController,
    AssignmentsController,
    ClassesController,
    HealthController,
    AssetsController,
  ],
  providers: [
    Database,
    AuthGuard,
    AssignmentsService,
    MultiTypeService,
    AssetsService,
    ClassesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
