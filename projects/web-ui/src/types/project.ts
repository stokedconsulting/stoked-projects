import type { StatusType } from './status';

export interface WorkItem {
  id: string;
  desc: string;
  done: boolean;
}

export interface Project {
  id: number;
  name: string;
  phase: number;
  totalPhases: number;
  status: string;
  statusType: StatusType;
  items: number;
  totalItems: number;
  updated: string;
  workItems: WorkItem[];
}
