import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LoggingModule } from '../src/common/logging/logging.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument, TaskStatus } from '../src/schemas/task.schema';
import { Session, SessionDocument, SessionStatus } from '../src/schemas/session.schema';

describe('Tasks Endpoints (e2e)', () => {
  let app: INestApplication;
  let taskModel: Model<TaskDocument>;
  let sessionModel: Model<SessionDocument>;
  const validApiKey = 'test-valid-api-key-12345678';

  let testSession: any;

  beforeAll(async () => {
    process.env.API_KEYS = validApiKey;
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/claude-projects-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LoggingModule, AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    taskModel = moduleFixture.get<Model<TaskDocument>>(getModelToken(Task.name));
    sessionModel = moduleFixture.get<Model<SessionDocument>>(getModelToken(Session.name));
  });

  beforeEach(async () => {
    // Clean up database before each test
    await taskModel.deleteMany({});
    await sessionModel.deleteMany({});

    // Create a test session for each test
    testSession = await sessionModel.create({
      session_id: 'test-session-id',
      project_id: 'test-project',
      machine_id: 'test-machine',
      status: SessionStatus.ACTIVE,
      last_heartbeat: new Date(),
      started_at: new Date(),
      metadata: {},
    });
  });

  afterAll(async () => {
    await taskModel.deleteMany({});
    await sessionModel.deleteMany({});
    await app.close();
  });

  describe('POST /tasks', () => {
    it('should create a new task', async () => {
      const createTaskDto = {
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        github_issue_id: '123',
        metadata: { priority: 'high' },
      };

      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('X-API-Key', validApiKey)
        .send(createTaskDto)
        .expect(201);

      expect(response.body).toMatchObject({
        session_id: createTaskDto.session_id,
        project_id: createTaskDto.project_id,
        task_name: createTaskDto.task_name,
        github_issue_id: createTaskDto.github_issue_id,
        status: TaskStatus.PENDING,
      });
      expect(response.body).toHaveProperty('task_id');
      expect(response.body.metadata).toEqual({ priority: 'high' });
    });

    it('should fail if session does not exist', async () => {
      const createTaskDto = {
        session_id: 'non-existent-session',
        project_id: 'test-project',
        task_name: 'Test Task',
      };

      await request(app.getHttpServer())
        .post('/tasks')
        .set('X-API-Key', validApiKey)
        .send(createTaskDto)
        .expect(404);
    });

    it('should fail with invalid data', async () => {
      const createTaskDto = {
        session_id: testSession.session_id,
        // missing project_id and task_name
      };

      await request(app.getHttpServer())
        .post('/tasks')
        .set('X-API-Key', validApiKey)
        .send(createTaskDto)
        .expect(400);
    });

    it('should require authentication', async () => {
      const createTaskDto = {
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
      };

      await request(app.getHttpServer())
        .post('/tasks')
        .send(createTaskDto)
        .expect(401);
    });
  });

  describe('GET /tasks', () => {
    beforeEach(async () => {
      // Create multiple tasks for testing
      await taskModel.create([
        {
          task_id: 'task-1',
          session_id: testSession.session_id,
          project_id: 'project-1',
          task_name: 'Task 1',
          status: TaskStatus.PENDING,
        },
        {
          task_id: 'task-2',
          session_id: testSession.session_id,
          project_id: 'project-1',
          task_name: 'Task 2',
          status: TaskStatus.IN_PROGRESS,
        },
        {
          task_id: 'task-3',
          session_id: 'other-session',
          project_id: 'project-2',
          task_name: 'Task 3',
          status: TaskStatus.COMPLETED,
        },
      ]);
    });

    it('should return all tasks', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(3);
    });

    it('should filter by session_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ session_id: testSession.session_id })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((t: any) => t.session_id === testSession.session_id)).toBe(true);
    });

    it('should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ status: TaskStatus.IN_PROGRESS })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should filter by project_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ project_id: 'project-1' })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((t: any) => t.project_id === 'project-1')).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks')
        .query({ limit: 2, offset: 0 })
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /tasks/:id', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.PENDING,
      });
    });

    it('should return a task by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tasks/${testTask.task_id}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.task_id).toBe(testTask.task_id);
      expect(response.body.task_name).toBe(testTask.task_name);
    });

    it('should return 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .get('/tasks/non-existent-id')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });
  });

  describe('PUT /tasks/:id', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.PENDING,
      });
    });

    it('should update task fields', async () => {
      const updateDto = {
        github_issue_id: '456',
        metadata: { priority: 'low' },
      };

      const response = await request(app.getHttpServer())
        .put(`/tasks/${testTask.task_id}`)
        .set('X-API-Key', validApiKey)
        .send(updateDto)
        .expect(200);

      expect(response.body.github_issue_id).toBe('456');
      expect(response.body.metadata.priority).toBe('low');
    });

    it('should validate status transitions', async () => {
      // Create a completed task
      const completedTask = await taskModel.create({
        task_id: 'completed-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Completed Task',
        status: TaskStatus.COMPLETED,
      });

      // Try to transition completed -> in_progress (invalid)
      await request(app.getHttpServer())
        .put(`/tasks/${completedTask.task_id}`)
        .set('X-API-Key', validApiKey)
        .send({ status: TaskStatus.IN_PROGRESS })
        .expect(400);
    });

    it('should return 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .put('/tasks/non-existent-id')
        .set('X-API-Key', validApiKey)
        .send({ github_issue_id: '789' })
        .expect(404);
    });
  });

  describe('DELETE /tasks/:id', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.PENDING,
      });
    });

    it('should soft delete a task', async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/${testTask.task_id}`)
        .set('X-API-Key', validApiKey)
        .expect(204);

      // Verify task is marked as completed
      const updatedTask = await taskModel.findOne({ task_id: testTask.task_id });
      expect(updatedTask?.status).toBe(TaskStatus.COMPLETED);
      expect(updatedTask?.completed_at).toBeDefined();
    });

    it('should return 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .delete('/tasks/non-existent-id')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });
  });

  describe('POST /tasks/:id/start', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.PENDING,
      });
    });

    it('should start a pending task', async () => {
      const response = await request(app.getHttpServer())
        .post(`/tasks/${testTask.task_id}/start`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.status).toBe(TaskStatus.IN_PROGRESS);
      expect(response.body.started_at).toBeDefined();

      // Verify session current_task_id is updated
      const updatedSession = await sessionModel.findOne({ session_id: testSession.session_id });
      expect(updatedSession?.current_task_id).toBe(testTask.task_id);
    });

    it('should fail if task is not pending', async () => {
      const inProgressTask = await taskModel.create({
        task_id: 'in-progress-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'In Progress Task',
        status: TaskStatus.IN_PROGRESS,
      });

      await request(app.getHttpServer())
        .post(`/tasks/${inProgressTask.task_id}/start`)
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should return 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .post('/tasks/non-existent-id/start')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });
  });

  describe('POST /tasks/:id/complete', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.IN_PROGRESS,
      });

      // Set current_task_id
      await sessionModel.findOneAndUpdate(
        { session_id: testSession.session_id },
        { current_task_id: testTask.task_id }
      );
    });

    it('should complete a task', async () => {
      const response = await request(app.getHttpServer())
        .post(`/tasks/${testTask.task_id}/complete`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.status).toBe(TaskStatus.COMPLETED);
      expect(response.body.completed_at).toBeDefined();

      // Verify session current_task_id is cleared
      const updatedSession = await sessionModel.findOne({ session_id: testSession.session_id });
      expect(updatedSession?.current_task_id).toBeUndefined();
    });

    it('should fail if task is already completed', async () => {
      const completedTask = await taskModel.create({
        task_id: 'completed-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Completed Task',
        status: TaskStatus.COMPLETED,
      });

      await request(app.getHttpServer())
        .post(`/tasks/${completedTask.task_id}/complete`)
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should fail if task is failed', async () => {
      const failedTask = await taskModel.create({
        task_id: 'failed-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Failed Task',
        status: TaskStatus.FAILED,
      });

      await request(app.getHttpServer())
        .post(`/tasks/${failedTask.task_id}/complete`)
        .set('X-API-Key', validApiKey)
        .expect(400);
    });
  });

  describe('POST /tasks/:id/fail', () => {
    let testTask: any;

    beforeEach(async () => {
      testTask = await taskModel.create({
        task_id: 'test-task-id',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Test Task',
        status: TaskStatus.IN_PROGRESS,
      });

      await sessionModel.findOneAndUpdate(
        { session_id: testSession.session_id },
        { current_task_id: testTask.task_id }
      );
    });

    it('should fail a task', async () => {
      const failDto = { error_message: 'Test error message' };

      const response = await request(app.getHttpServer())
        .post(`/tasks/${testTask.task_id}/fail`)
        .set('X-API-Key', validApiKey)
        .send(failDto)
        .expect(200);

      expect(response.body.status).toBe(TaskStatus.FAILED);
      expect(response.body.error_message).toBe('Test error message');
      expect(response.body.completed_at).toBeDefined();

      // Verify session current_task_id is cleared
      const updatedSession = await sessionModel.findOne({ session_id: testSession.session_id });
      expect(updatedSession?.current_task_id).toBeUndefined();
    });

    it('should require error_message', async () => {
      await request(app.getHttpServer())
        .post(`/tasks/${testTask.task_id}/fail`)
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(400);
    });

    it('should fail if task is completed', async () => {
      const completedTask = await taskModel.create({
        task_id: 'completed-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Completed Task',
        status: TaskStatus.COMPLETED,
      });

      await request(app.getHttpServer())
        .post(`/tasks/${completedTask.task_id}/fail`)
        .set('X-API-Key', validApiKey)
        .send({ error_message: 'Test error' })
        .expect(400);
    });

    it('should fail if task is already failed', async () => {
      const failedTask = await taskModel.create({
        task_id: 'failed-task',
        session_id: testSession.session_id,
        project_id: 'test-project',
        task_name: 'Failed Task',
        status: TaskStatus.FAILED,
      });

      await request(app.getHttpServer())
        .post(`/tasks/${failedTask.task_id}/fail`)
        .set('X-API-Key', validApiKey)
        .send({ error_message: 'Test error' })
        .expect(400);
    });
  });

  describe('GET /sessions/:id/tasks', () => {
    beforeEach(async () => {
      // Create tasks with various statuses
      await taskModel.create([
        {
          task_id: 'task-1',
          session_id: testSession.session_id,
          project_id: 'test-project',
          task_name: 'Task 1',
          status: TaskStatus.PENDING,
        },
        {
          task_id: 'task-2',
          session_id: testSession.session_id,
          project_id: 'test-project',
          task_name: 'Task 2',
          status: TaskStatus.IN_PROGRESS,
        },
        {
          task_id: 'task-3',
          session_id: testSession.session_id,
          project_id: 'test-project',
          task_name: 'Task 3',
          status: TaskStatus.COMPLETED,
        },
        {
          task_id: 'task-4',
          session_id: testSession.session_id,
          project_id: 'test-project',
          task_name: 'Task 4',
          status: TaskStatus.COMPLETED,
        },
        {
          task_id: 'task-5',
          session_id: testSession.session_id,
          project_id: 'test-project',
          task_name: 'Task 5',
          status: TaskStatus.FAILED,
        },
      ]);
    });

    it('should return tasks grouped by status with statistics', async () => {
      const response = await request(app.getHttpServer())
        .get(`/sessions/${testSession.session_id}/tasks`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.session_id).toBe(testSession.session_id);
      expect(response.body.tasks).toBeDefined();
      expect(response.body.tasks.pending).toHaveLength(1);
      expect(response.body.tasks.in_progress).toHaveLength(1);
      expect(response.body.tasks.completed).toHaveLength(2);
      expect(response.body.tasks.failed).toHaveLength(1);
      expect(response.body.tasks.blocked).toHaveLength(0);

      expect(response.body.stats).toMatchObject({
        total: 5,
        pending: 1,
        in_progress: 1,
        completed: 2,
        failed: 1,
        blocked: 0,
        completion_percentage: 40, // 2 out of 5
      });
    });

    it('should return 404 for non-existent session', async () => {
      await request(app.getHttpServer())
        .get('/sessions/non-existent-session/tasks')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should handle empty task list', async () => {
      const emptySession = await sessionModel.create({
        session_id: 'empty-session',
        project_id: 'test-project',
        machine_id: 'test-machine',
        status: SessionStatus.ACTIVE,
        last_heartbeat: new Date(),
        started_at: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/sessions/${emptySession.session_id}/tasks`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.stats.total).toBe(0);
      expect(response.body.stats.completion_percentage).toBe(0);
    });
  });
});
