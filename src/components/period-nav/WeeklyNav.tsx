/**
 * Temporary compatibility wrapper.
 * Replace all <WeeklyNav /> usages with <PeriodNav period="week" />,
 * then delete this file.
 *
 * @deprecated Use <PeriodNav period="week" /> directly.
 */
import React from 'react';
import { PeriodNav } from './PeriodNav';
import type { PeriodRange } from './types';

interface WeeklyNavProps {
  onChange?: (range: PeriodRange, queryParams: Record<string, string>) => void;
  className?: string;
}

export function WeeklyNav({ onChange, className }: WeeklyNavProps) {
  return <PeriodNav period="week" onChange={onChange} className={className} />;
}
