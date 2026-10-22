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
  createAssignmentV2Schema,
  updateAssignmentV2Schema,
  submissionV2Schema,
  validateAssignmentV2Schema,
  gradingDraftSchema,
  gradingPublishSchema,
} from '@amp/contracts';
import { z } from 'zod';
import { AuthGuard, type AuthRequest } from '../auth/auth.js';
import { AssignmentsService } from './assignments.service.js';
import { MultiTypeService } from './multi-type.service.js';

const readVersionSchema = z.coerce
  .number()
  .int()
  .refine((value) => value === 1 || value === 2)
  .default(1);
const reportQuerySchema = paginationSchema
  .extend({
    schemaVersion: readVersionSchema,
    gradingStatus: z.enum(['GRADED', 'PENDING_REVIEW']).optional(),
  })
  .strict();
const v2Body = (body: unknown) =>
  !!body && typeof body === 'object' && 'schemaVersion' in body && body.schemaVersion === 2;

@Controller()
@UseGuards(AuthGuard)
export class AssignmentsController {
  constructor(
    @Inject(AssignmentsService) private readonly service: AssignmentsService,
    @Inject(MultiTypeService) private readonly multi: MultiTypeService,
  ) {}
  @Get('classes') classes(@Req() req: AuthRequest) {
    return this.service.classes(req.actor);
  }
  @Get('assignments') list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.list(req.actor, assignmentQuerySchema.parse(query));
  }
  @Post('assignments') create(@Req() req: AuthRequest, @Body() body: unknown) {
    if (v2Body(body)) return this.multi.create(req.actor, createAssignmentV2Schema.parse(body));
    return this.service.create(req.actor, createAssignmentSchema.parse(body));
  }
  @Patch('assignments/:id') update(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    if (v2Body(body)) return this.multi.update(req.actor, id, updateAssignmentV2Schema.parse(body));
    return this.service.update(req.actor, id, updateAssignmentSchema.parse(body));
  }
  @Delete('assignments/:id') remove(@Req() req: AuthRequest, @Param('id', uuidPipe) id: string) {
    return this.multi.remove(req.actor, id);
  }
  @Get('assignments/:id/submissions') submissions(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Query() query: unknown,
  ) {
    const { page, pageSize, schemaVersion, gradingStatus } = reportQuerySchema.parse(query);
    if (schemaVersion === 2)
      return this.multi.submissions(req.actor, id, page, pageSize, gradingStatus);
    return this.service.submissions(req.actor, id, page, pageSize);
  }
  @Get('assignments/:id') detail(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Query('schemaVersion') version: unknown,
  ) {
    if (readVersionSchema.parse(version) === 2) return this.multi.detail(req.actor, id);
    return this.service.detail(req.actor, id);
  }
  @Post('assignments/:id/publish') publish(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    if (v2Body(body)) return this.multi.publish(req.actor, id, body);
    return this.service.publish(req.actor, id, body);
  }
  @Post('assignments/:id/submissions') submit(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    if (v2Body(body)) return this.multi.submit(req.actor, id, submissionV2Schema.parse(body));
    return this.service.submit(req.actor, id, submissionSchema.parse(body));
  }
  @Get('assignments/:id/stats') stats(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Query('schemaVersion') version: unknown,
  ) {
    if (readVersionSchema.parse(version) === 2) return this.multi.stats(req.actor, id);
    return this.service.stats(req.actor, id);
  }
  @Post('assignments/:id/validate') validate(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = validateAssignmentV2Schema.parse(body);
    return this.multi.validate(req.actor, id, input.version, input.questions);
  }
  @Get('assignments/:id/submissions/:submissionId') submissionDetail(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Param('submissionId', uuidPipe) submissionId: string,
  ) {
    return this.multi.submissionDetail(req.actor, id, submissionId);
  }
  @Get('assignments/:id/question-stats') questionStats(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.multi.questionStats(req.actor, id);
  }
  @Patch('submissions/:submissionId/grading') saveGrading(
    @Req() req: AuthRequest,
    @Param('submissionId', uuidPipe) submissionId: string,
    @Body() body: unknown,
  ) {
    return this.multi.saveGrading(req.actor, submissionId, gradingDraftSchema.parse(body));
  }
  @Post('submissions/:submissionId/grading/publish') publishGrading(
    @Req() req: AuthRequest,
    @Param('submissionId', uuidPipe) submissionId: string,
    @Body() body: unknown,
  ) {
    return this.multi.publishGrading(req.actor, submissionId, gradingPublishSchema.parse(body));
  }
}
