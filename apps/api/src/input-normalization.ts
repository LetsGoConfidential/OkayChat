import { Transform } from 'class-transformer';

export function trimInput(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const TrimInput = () => Transform(({ value }) => trimInput(value));
