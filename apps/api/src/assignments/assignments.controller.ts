import { uuidPipe } from '../validation.js';
import {
  Body,
  Patch,
  Delete,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createAssignmentSchema,
  updateAssignmentSchema,
  assignmentQuerySchema,
  paginationSchema,
  submissionSchema,
} from '@amp/contracts';
import { AuthGuard, type AuthRequest } from '../auth/auth.js';
import { AssignmentsService } from './assignments.service.js';

@Controller()
@UseGuards(AuthGuard)
export class AssignmentsController {
  constructor(@Inject(AssignmentsService) private readonly service: AssignmentsService) {}
  @Get('classes') classes(@Req() req: AuthRequest) {
    return this.service.classes(req.actor);
  }
  @Get('assignments') list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.list(req.actor, assignmentQuerySchema.parse(query));
  }
  @Post('assignments') create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.actor, createAssignmentSchema.parse(body));
  }
  @Patch('assignments/:id') update(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(req.actor, id, updateAssignmentSchema.parse(body));
  }
  @Delete('assignments/:id') remove(@Req() req: AuthRequest, @Param('id', uuidPipe) id: string) {
    return this.service.remove(req.actor, id);
  }
  @Get('assignments/:id/submissions') submissions(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Query() query: unknown,
  ) {
    const { page, pageSize } = paginationSchema.parse(query);
    return this.service.submissions(req.actor, id, page, pageSize);
  }
  @Get('assignments/:id') detail(@Req() req: AuthRequest, @Param('id', uuidPipe) id: string) {
    return this.service.detail(req.actor, id);
  }
  @Post('assignments/:id/publish') publish(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.service.publish(req.actor, id);
  }
  @Post('assignments/:id/submissions') submit(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.submit(req.actor, id, submissionSchema.parse(body));
  }
  @Get('assignments/:id/stats') stats(@Req() req: AuthRequest, @Param('id', uuidPipe) id: string) {
    return this.service.stats(req.actor, id);
  }
}
