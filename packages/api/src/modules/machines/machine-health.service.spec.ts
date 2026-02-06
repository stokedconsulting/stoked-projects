import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MachineHealthService } from './machine-health.service';
import { Machine, MachineDocument, MachineStatus } from '../../schemas/machine.schema';
import { Session, SessionDocument, SessionStatus } from '../../schemas/session.schema';

describe('MachineHealthService', () => {
  let service: MachineHealthService;
  let machineModel: Model<MachineDocument>;
  let sessionModel: Model<SessionDocument>;

  const mockMachineModel = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockSessionModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachineHealthService,
        {
          provide: getModelToken(Machine.name),
          useValue: mockMachineModel,
        },
        {
          provide: getModelToken(Session.name),
          useValue: mockSessionModel,
        },
      ],
    }).compile();

    service = module.get<MachineHealthService>(MachineHealthService);
    machineModel = module.get<Model<MachineDocument>>(getModelToken(Machine.name));
    sessionModel = module.get<Model<SessionDocument>>(getModelToken(Session.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAvailableMachines', () => {
    it('should find all online machines with availability info', async () => {
      const machines = [
        {
          machine_id: 'machine-1',
          hostname: 'host1',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2, 3, 4],
          active_sessions: ['session-1'],
          last_heartbeat: new Date(),
        },
        {
          machine_id: 'machine-2',
          hostname: 'host2',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2],
          active_sessions: [],
          last_heartbeat: new Date(),
        },
      ];

      mockMachineModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(machines),
        }),
      });

      // Mock sessions for machine-1 (1 active session using slot 1)
      mockSessionModel.find
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([
            {
              session_id: 'session-1',
              machine_id: 'machine-1',
              status: SessionStatus.ACTIVE,
              docker_slot: 1,
            },
          ]),
        })
        // Mock sessions for machine-2 (no active sessions)
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([]),
        });

      const result = await service.findAvailableMachines();

      expect(result).toHaveLength(2);
      expect(mockMachineModel.find).toHaveBeenCalledWith({
        status: MachineStatus.ONLINE,
      });

      // Check machine-1 availability
      const machine1 = result.find((m) => m.machine_id === 'machine-1');
      expect(machine1?.total_slots).toBe(4);
      expect(machine1?.occupied_slots).toBe(1);
      expect(machine1?.available_slots).toBe(3);
      expect(machine1?.available_slot_numbers).toEqual([2, 3, 4]);

      // Check machine-2 availability
      const machine2 = result.find((m) => m.machine_id === 'machine-2');
      expect(machine2?.total_slots).toBe(2);
      expect(machine2?.occupied_slots).toBe(0);
      expect(machine2?.available_slots).toBe(2);
      expect(machine2?.available_slot_numbers).toEqual([1, 2]);
    });

    it('should sort machines by most available slots', async () => {
      const machines = [
        {
          machine_id: 'machine-1',
          hostname: 'host1',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2],
          active_sessions: ['session-1', 'session-2'],
          last_heartbeat: new Date(),
        },
        {
          machine_id: 'machine-2',
          hostname: 'host2',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2, 3, 4],
          active_sessions: ['session-3'],
          last_heartbeat: new Date(),
        },
      ];

      mockMachineModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(machines),
        }),
      });

      // Mock sessions for machine-1 (2 active sessions)
      mockSessionModel.find
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([
            { session_id: 'session-1', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 1 },
            { session_id: 'session-2', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 2 },
          ]),
        })
        // Mock sessions for machine-2 (1 active session)
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([
            { session_id: 'session-3', machine_id: 'machine-2', status: SessionStatus.ACTIVE, docker_slot: 1 },
          ]),
        });

      const result = await service.findAvailableMachines();

      // machine-2 should be first (3 available slots) before machine-1 (0 available slots)
      expect(result[0].machine_id).toBe('machine-2');
      expect(result[0].available_slots).toBe(3);
      expect(result[1].machine_id).toBe('machine-1');
      expect(result[1].available_slots).toBe(0);
    });

    it('should only include online machines', async () => {
      mockMachineModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.findAvailableMachines();

      expect(mockMachineModel.find).toHaveBeenCalledWith({
        status: MachineStatus.ONLINE,
      });
    });

    it('should handle machines with no docker slots', async () => {
      const machines = [
        {
          machine_id: 'machine-1',
          hostname: 'host1',
          status: MachineStatus.ONLINE,
          docker_slots: [],
          active_sessions: [],
          last_heartbeat: new Date(),
        },
      ];

      mockMachineModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(machines),
        }),
      });

      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      const result = await service.findAvailableMachines();

      expect(result).toHaveLength(1);
      expect(result[0].total_slots).toBe(0);
      expect(result[0].available_slots).toBe(0);
    });

    it('should ignore sessions without docker_slot assigned', async () => {
      const machines = [
        {
          machine_id: 'machine-1',
          hostname: 'host1',
          status: MachineStatus.ONLINE,
          docker_slots: [1, 2, 3],
          active_sessions: ['session-1', 'session-2'],
          last_heartbeat: new Date(),
        },
      ];

      mockMachineModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(machines),
        }),
      });

      // One session has docker_slot, one doesn't
      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { session_id: 'session-1', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 1 },
          { session_id: 'session-2', machine_id: 'machine-1', status: SessionStatus.ACTIVE },
        ]),
      });

      const result = await service.findAvailableMachines();

      expect(result[0].occupied_slots).toBe(1); // Only session-1 counts
      expect(result[0].available_slots).toBe(2);
      expect(result[0].available_slot_numbers).toEqual([2, 3]);
    });
  });

  describe('getMachineAvailability', () => {
    it('should get availability for specific machine', async () => {
      const machine = {
        machine_id: 'machine-1',
        hostname: 'host1',
        status: MachineStatus.ONLINE,
        docker_slots: [1, 2, 3, 4],
        active_sessions: ['session-1', 'session-2'],
        last_heartbeat: new Date(),
      };

      mockMachineModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(machine),
      });

      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { session_id: 'session-1', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 1 },
          { session_id: 'session-2', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 3 },
        ]),
      });

      const result = await service.getMachineAvailability('machine-1');

      expect(result).not.toBeNull();
      expect(result?.machine_id).toBe('machine-1');
      expect(result?.total_slots).toBe(4);
      expect(result?.occupied_slots).toBe(2);
      expect(result?.available_slots).toBe(2);
      expect(result?.available_slot_numbers).toEqual([2, 4]);
      expect(mockMachineModel.findOne).toHaveBeenCalledWith({
        machine_id: 'machine-1',
      });
    });

    it('should return null for non-existent machine', async () => {
      mockMachineModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.getMachineAvailability('non-existent');

      expect(result).toBeNull();
    });

    it('should handle machine with all slots occupied', async () => {
      const machine = {
        machine_id: 'machine-1',
        hostname: 'host1',
        status: MachineStatus.ONLINE,
        docker_slots: [1, 2],
        active_sessions: ['session-1', 'session-2'],
        last_heartbeat: new Date(),
      };

      mockMachineModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(machine),
      });

      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { session_id: 'session-1', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 1 },
          { session_id: 'session-2', machine_id: 'machine-1', status: SessionStatus.ACTIVE, docker_slot: 2 },
        ]),
      });

      const result = await service.getMachineAvailability('machine-1');

      expect(result?.available_slots).toBe(0);
      expect(result?.available_slot_numbers).toEqual([]);
    });

    it('should handle machine with no active sessions', async () => {
      const machine = {
        machine_id: 'machine-1',
        hostname: 'host1',
        status: MachineStatus.ONLINE,
        docker_slots: [1, 2, 3],
        active_sessions: [],
        last_heartbeat: new Date(),
      };

      mockMachineModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(machine),
      });

      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getMachineAvailability('machine-1');

      expect(result?.occupied_slots).toBe(0);
      expect(result?.available_slots).toBe(3);
      expect(result?.available_slot_numbers).toEqual([1, 2, 3]);
    });

    it('should work with offline machines', async () => {
      const machine = {
        machine_id: 'machine-1',
        hostname: 'host1',
        status: MachineStatus.OFFLINE,
        docker_slots: [1, 2],
        active_sessions: [],
        last_heartbeat: new Date(),
      };

      mockMachineModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(machine),
      });

      mockSessionModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getMachineAvailability('machine-1');

      expect(result).not.toBeNull();
      expect(result?.status).toBe(MachineStatus.OFFLINE);
    });
  });
});
