import crypto from 'crypto';
import dayjs from 'dayjs';

export const timeout = (length = 0) => new Promise(resolve => setTimeout(resolve, length));

export const generateId = (): string => {
  return crypto.randomBytes(16)
    .toString('hex');
};

export const httpLogPatt = /^([.0123456789]+)\s\[(.+?)].+\s(\d{3})\s(\d+)\s\{(.+?)}/;

export const gmtToIsoDate = (gmtDate: string): string => dayjs(gmtDate, 'DD/MMM/YYYY HH:mm:ss ZZ').toISOString();
