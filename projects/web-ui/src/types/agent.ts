import type { StatusType } from './status';

export interface Agent {
  id: string;
  task: string;
  workspace: string;
  status: string;
  type: StatusType;
  duration: string;
}
