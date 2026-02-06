import { Test, TestingModule } from '@nestjs/testing';
import { MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';
import { MachineHealthService } from './machine-health.service';
import { MachineStatus } from '../../schemas/machine.schema';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { AssignSessionDto } from './dto/assign-session.dto';
import { ReleaseSessionDto } from './dto/release-session.dto';

describe('MachinesController', () => {
  let controller: MachinesController;
  let service: MachinesService;
  let healthService: MachineHealthService;

  const mockMachine = {
    machine_id: 'machine-1',
    hostname: 'test-host',
    docker_slots: [1, 2, 3],
    active_sessions: [],
    status: MachineStatus.ONLINE,
    last_heartbeat: new Date(),
    metadata: {},
  };

  const mockMachinesService = {
    findAll: jest.fn().mockResolvedValue([mockMachine]),
    findOne: jest.fn().mockResolvedValue(mockMachine),
    create: jest.fn().mockResolvedValue(mockMachine),
    update: jest.fn().mockResolvedValue(mockMachine),
    delete: jest.fn().mockResolvedValue(undefined),
    assignSession: jest.fn().mockResolvedValue(mockMachine),
    releaseSession: jest.fn().mockResolvedValue(mockMachine),
    updateHeartbeat: jest.fn().mockResolvedValue(mockMachine),
  };

  const mockMachineHealthService = {
    findAvailableMachines: jest.fn().mockResolvedValue([
      {
        machine_id: 'machine-1',
        hostname: 'test-host',
        total_slots: 3,
        available_slots: 3,
        status: MachineStatus.ONLINE,
      },
    ]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MachinesController],
      providers: [
        {
          provide: MachinesService,
          useValue: mockMachinesService,
        },
        {
          provide: MachineHealthService,
          useValue: mockMachineHealthService,
        },
      ],
    })
    .overrideGuard(require('../auth/guards/api-key.guard').ApiKeyGuard)
    .useValue({ canActivate: () => true })
    .compile();

    controller = module.get<MachinesController>(MachinesController);
    service = module.get<MachinesService>(MachinesService);
    healthService = module.get<MachineHealthService>(MachineHealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAvailableMachines', () => {
    it('should return available machines', async () => {
      const result = await controller.findAvailableMachines();
      expect(result).toBeDefined();
      expect(healthService.findAvailableMachines).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all machines', async () => {
      const result = await controller.findAll({});
      expect(result).toEqual([mockMachine]);
      expect(service.findAll).toHaveBeenCalledWith({});
    });

    it('should filter by status', async () => {
      await controller.findAll({ status: MachineStatus.ONLINE });
      expect(service.findAll).toHaveBeenCalledWith({ status: MachineStatus.ONLINE });
    });

    it('should filter by hostname', async () => {
      await controller.findAll({ hostname: 'test-host' });
      expect(service.findAll).toHaveBeenCalledWith({ hostname: 'test-host' });
    });
  });

  describe('findOne', () => {
    it('should return a machine by ID', async () => {
      const result = await controller.findOne('machine-1');
      expect(result).toEqual(mockMachine);
      expect(service.findOne).toHaveBeenCalledWith('machine-1');
    });
  });

  describe('create', () => {
    it('should create a new machine', async () => {
      const createDto: CreateMachineDto = {
        machine_id: 'machine-1',
        hostname: 'test-host',
        docker_slots: [1, 2, 3],
        metadata: {},
      };

      const result = await controller.create(createDto);
      expect(result).toEqual(mockMachine);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('update', () => {
    it('should update a machine', async () => {
      const updateDto: UpdateMachineDto = {
        status: MachineStatus.MAINTENANCE,
      };

      const result = await controller.update('machine-1', updateDto);
      expect(result).toEqual(mockMachine);
      expect(service.update).toHaveBeenCalledWith('machine-1', updateDto);
    });
  });

  describe('delete', () => {
    it('should delete a machine', async () => {
      await controller.delete('machine-1');
      expect(service.delete).toHaveBeenCalledWith('machine-1');
    });
  });

  describe('assignSession', () => {
    it('should assign session to machine', async () => {
      const assignDto: AssignSessionDto = {
        session_id: 'session-1',
        docker_slot: 1,
      };

      const result = await controller.assignSession('machine-1', assignDto);
      expect(result).toEqual(mockMachine);
      expect(service.assignSession).toHaveBeenCalledWith('machine-1', assignDto);
    });
  });

  describe('releaseSession', () => {
    it('should release session from machine', async () => {
      const releaseDto: ReleaseSessionDto = {
        session_id: 'session-1',
      };

      const result = await controller.releaseSession('machine-1', releaseDto);
      expect(result).toEqual(mockMachine);
      expect(service.releaseSession).toHaveBeenCalledWith('machine-1', releaseDto);
    });
  });

  describe('updateHeartbeat', () => {
    it('should update machine heartbeat', async () => {
      const result = await controller.updateHeartbeat('machine-1');
      expect(result).toBeDefined();
      expect(result.machine_id).toEqual('machine-1');
      expect(result.message).toBeDefined();
      expect(service.updateHeartbeat).toHaveBeenCalledWith('machine-1');
    });
  });
});
