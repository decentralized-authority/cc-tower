import path from 'path';

export const DOCKER_HOST = 'host.docker.internal';

const userDir = process.env.HOME || process.env.USERPROFILE;
export const rootDir = userDir ? path.join(userDir, '.cc-gateway') : '.cc-gateway';
export const configPath = path.join(rootDir, 'config.json');
export const logDir = path.join(rootDir, 'logs');

export const DOCKER_NETWORK = 'cc-gateway-network';
