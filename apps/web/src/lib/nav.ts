import { History, LayoutGrid, ListChecks, Wrench, type LucideIcon } from 'lucide-react';

export type Page = 'fleet' | 'fixes' | 'checks' | 'activity' | 'device';

export interface NavItem {
  page: Page;
  label: string;
  hash: string;
  icon: LucideIcon;
  hint: string;
}

export const NAV: NavItem[] = [
  { page: 'fleet', label: 'Fleet', hash: '#/', icon: LayoutGrid, hint: 'Every enrolled UMD' },
  { page: 'fixes', label: 'Fix center', hash: '#/fixes', icon: Wrench, hint: 'Checks that need action' },
  { page: 'checks', label: 'Test cases', hash: '#/checks', icon: ListChecks, hint: 'Validation catalog' },
  { page: 'activity', label: 'Activity', hash: '#/activity', icon: History, hint: 'Fix jobs across the fleet' },
];
