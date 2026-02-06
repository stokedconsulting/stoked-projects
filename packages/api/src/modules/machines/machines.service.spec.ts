import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { MachinesService } from './machines.service';
import { Machine, MachineDocument, MachineStatus } from '../../schemas/machine.schema';
import { Session, SessionDocument } from '../../schemas/session.schema';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { AssignSessionDto } from './dto/assign-session.dto';
import { ReleaseSessionDto } from './dto/release-session.dto';

describe('MachinesService', () => {
  let service: MachinesService;
  let machineModel: Model<MachineDocument>;
  let sessionModel: Model<SessionDocument>;

  const mockMachine = {
    machine_id: 'machine-1',
    hostname: 'test-host',
    docker_slots: [1, 2, 3],
    active_sessions: [],
    status: MachineStatus.ONLINE,
    last_heartbeat: new Date(),
    metadata: {},
  };

  const mockSession = {
    session_id: 'session-1',
    project_id: 'project-1',
    machine_id: 'machine-1',
    docker_slot: 1,
    status: 'active',
    last_heartbeat: new Date(),
    started_at: new Date(),
    metadata: {},
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachinesService,
        {
          provide: getModelToken(Machine.name),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            findOneAndDelete: jest.fn(),
            updateMany: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            exec: jest.fn(),
          },
        },
        {
          provide: getModelToken(Session.name),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            exec: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MachinesService>(MachinesService);
    machineModel = module.get<Model<MachineDocument>>(getModelToken(Machine.name));
    sessionModel = module.get<Model<SessionDocument>>(getModelToken(Session.name));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all machines', async () => {
      const machines = [mockMachine];
      jest.spyOn(machineModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machines),
      } as any);

      const result = await service.findAll();
      expect(result).toEqual(machines);
      expect(machineModel.find).toHaveBeenCalledWith({});
    });

    it('should filter by status', async () => {
      const machines = [mockMachine];
      jest.spyOn(machineModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machines),
      } as any);

      await service.findAll({ status: MachineStatus.ONLINE });
      expect(machineModel.find).toHaveBeenCalledWith({ status: MachineStatus.ONLINE });
    });

    it('should filter by hostname', async () => {
      const machines = [mockMachine];
      jest.spyOn(machineModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machines),
      } as any);

      await service.findAll({ hostname: 'test-host' });
      expect(machineModel.find).toHaveBeenCalledWith({ hostname: 'test-host' });
    });
  });

  describe('findOne', () => {
    it('should return a machine by ID', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      const result = await service.findOne('machine-1');
      expect(result).toEqual(mockMachine);
    });

    it('should throw NotFoundException if machine not found', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const createDto: CreateMachineDto = {
      machine_id: 'machine-1',
      hostname: 'test-host',
      docker_slots: [1, 2, 3],
      metadata: {},
    };

    it('should create a new machine', async () => {
      const saveMock = jest.fn().mockResolvedValue(mockMachine);

      // Store original model
      const originalModel = (service as any).machineModel;

      // Mock findOne to return null (machine doesn't exist)
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      // Create a mock constructor that returns an object with save method
      const mockConstructor: any = jest.fn().mockImplementation(() => ({
        save: saveMock,
      }));

      // Keep findOne method on the constructor
      mockConstructor.findOne = machineModel.findOne;

      // Replace the service's model temporarily
      (service as any).machineModel = mockConstructor;

      const result = await service.create(createDto);
      expect(saveMock).toHaveBeenCalled();

      // Restore original model
      (service as any).machineModel = originalModel;
    });

    it('should throw ConflictException if machine already exists', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for non-unique docker slots', async () => {
      const invalidDto = { ...createDto, docker_slots: [1, 1, 2] };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(service.create(invalidDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative docker slots', async () => {
      const invalidDto = { ...createDto, docker_slots: [1, -1, 2] };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(service.create(invalidDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update a machine', async () => {
      const updateDto: UpdateMachineDto = {
        status: MachineStatus.MAINTENANCE,
      };

      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...mockMachine, ...updateDto }),
      } as any);

      const result = await service.update('machine-1', updateDto);
      expect(result.status).toEqual(MachineStatus.MAINTENANCE);
    });

    it('should prevent removing docker slots in use', async () => {
      const machineWithSession = { ...mockMachine, active_sessions: ['session-1'] };
      const updateDto: UpdateMachineDto = {
        docker_slots: [2, 3], // Removing slot 1 which is in use
      };

      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machineWithSession),
      } as any);

      jest.spyOn(sessionModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockSession]),
      } as any);

      await expect(service.update('machine-1', updateDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('should set machine status to offline', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...mockMachine, status: MachineStatus.OFFLINE }),
      } as any);

      await service.delete('machine-1');
      expect(machineModel.findOneAndUpdate).toHaveBeenCalledWith(
        { machine_id: 'machine-1' },
        { status: MachineStatus.OFFLINE }
      );
    });
  });

  describe('assignSession', () => {
    const assignDto: AssignSessionDto = {
      session_id: 'session-1',
      docker_slot: 1,
    };

    it('should assign session to machine with specified slot', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(sessionModel, 'findOne')
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(mockSession),
        } as any)
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(null),
        } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockMachine,
          active_sessions: ['session-1'],
        }),
      } as any);

      jest.spyOn(sessionModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      } as any);

      const result = await service.assignSession('machine-1', assignDto);
      expect(result.active_sessions).toContain('session-1');
    });

    it('should throw BadRequestException if machine is offline', async () => {
      const offlineMachine = { ...mockMachine, status: MachineStatus.OFFLINE };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(offlineMachine),
      } as any);

      await expect(service.assignSession('machine-1', assignDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw NotFoundException if session not found', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(sessionModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(service.assignSession('machine-1', assignDto)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if session already assigned', async () => {
      const machineWithSession = { ...mockMachine, active_sessions: ['session-1'] };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machineWithSession),
      } as any);

      jest.spyOn(sessionModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      } as any);

      await expect(service.assignSession('machine-1', assignDto)).rejects.toThrow(
        ConflictException
      );
    });

    it('should throw BadRequestException if slot not available', async () => {
      const invalidDto = { ...assignDto, docker_slot: 99 };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(sessionModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockSession),
      } as any);

      await expect(service.assignSession('machine-1', invalidDto)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw ConflictException if slot already occupied', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(sessionModel, 'findOne')
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(mockSession),
        } as any)
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue({ ...mockSession, session_id: 'other-session' }),
        } as any);

      await expect(service.assignSession('machine-1', assignDto)).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('releaseSession', () => {
    const releaseDto: ReleaseSessionDto = {
      session_id: 'session-1',
    };

    it('should release session from machine', async () => {
      const machineWithSession = { ...mockMachine, active_sessions: ['session-1'] };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(machineWithSession),
      } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...mockMachine, active_sessions: [] }),
      } as any);

      const result = await service.releaseSession('machine-1', releaseDto);
      expect(result.active_sessions).not.toContain('session-1');
    });

    it('should throw BadRequestException if session not assigned to machine', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      await expect(service.releaseSession('machine-1', releaseDto)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('updateHeartbeat', () => {
    it('should update heartbeat', async () => {
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockMachine),
      } as any);

      const result = await service.updateHeartbeat('machine-1');
      expect(result).toBeDefined();
    });

    it('should bring offline machine back online', async () => {
      const offlineMachine = { ...mockMachine, status: MachineStatus.OFFLINE };
      jest.spyOn(machineModel, 'findOne').mockReturnValue({
        exec: jest.fn().mockResolvedValue(offlineMachine),
      } as any);

      jest.spyOn(machineModel, 'findOneAndUpdate').mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...offlineMachine, status: MachineStatus.ONLINE }),
      } as any);

      const result = await service.updateHeartbeat('machine-1');
      expect(result.status).toEqual(MachineStatus.ONLINE);
    });
  });

  describe('detectOfflineMachines', () => {
    it('should mark stale machines as offline', async () => {
      jest.spyOn(machineModel, 'updateMany').mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      } as any);

      jest.spyOn(machineModel, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([{ machine_id: 'machine-1' }]),
        }),
      } as any);

      const result = await service.detectOfflineMachines(10);
      expect(result).toContain('machine-1');
    });
  });
});
