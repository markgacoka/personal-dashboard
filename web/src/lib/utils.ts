import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function groupBy<T, K extends string>(xs: T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const x of xs) (out[key(x)] ||= []).push(x)
  return out
}
