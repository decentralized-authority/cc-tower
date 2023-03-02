import fs from 'fs-extra';

export interface LocalConfigData {
  apiEndpoint: string;
  providerId: string;
  gatewayId: string;
  keyFilePath: string;
  hapCpus: number;
  hapMem: number;
}

export class LocalConfig {

  static defaultHapCpus = 3;
  static defaultHapMem = 4096;

  apiEndpoint: string;
  providerId: string;
  gatewayId: string;
  keyFilePath: string;
  hapCpus: number;
  hapMem: number;

  constructor(config: LocalConfigData) {
    this.apiEndpoint = config.apiEndpoint;
    this.providerId = config.providerId;
    this.gatewayId = config.gatewayId;
    this.keyFilePath = config.keyFilePath;
    this.hapCpus = config.hapCpus;
    this.hapMem = config.hapMem;
  }

  toObject(): LocalConfigData {
    return {
      apiEndpoint: this.apiEndpoint,
      providerId: this.providerId,
      gatewayId: this.gatewayId,
      keyFilePath: this.keyFilePath,
      hapCpus: this.hapCpus,
      hapMem: this.hapMem,
    };
  }

  getKey(): string {
    return fs.readFileSync(this.keyFilePath, 'utf8').trim();
  }

}
