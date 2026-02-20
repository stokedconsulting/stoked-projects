import type { LucideIcon } from 'lucide-react';

export interface TimelineEvent {
  id: number;
  type: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  text: string;
  agent: string;
  time: string;
  group: string;
}
