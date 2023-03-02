import { spawn } from 'child_process';
import { timeout } from '../util';
import { parse } from 'csv-parse';

export class HapRuntimeApi {

  readonly _host: string;
  readonly _port: number;
  _timeout = 5;

  constructor(host: string, port: number) {
    this._host = host;
    this._port = port;
  }

  private execute(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let instance = spawn(
        'bash',
        ['-c', `echo "${command}" | socat -t ${this._timeout} stdio tcp4-connect:${this._host}:${this._port}`],
      );
      let output = '';
      instance.stdout.on('data', data => {
        output += data.toString();
      });
      instance.stderr.on('data', data => {
        output += data.toString();
      });
      instance.on('error', err => {
        reject(err);
      });
      instance.on('close', () => {
        // @ts-ignore
        instance = null;
        resolve(output
          .split('\n')
          .map(s => s.trim())
          .filter(s => !!s)
          .join('\n')
        );
      });
    });
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await this.showVersion();
      return !!(res && !/connection\srefused/i.test(res));
    } catch(err) {
      return false;
    }
  }

  async ready(): Promise<boolean> {
    let ready = false;
    while(!ready) {
      ready = await this.isReady();
      await timeout(1000);
    }
    return ready;
  }

  async help(): Promise<string> {
    return await this.execute('help');
  }

  async showVersion(): Promise<string> {
    return await this.execute('show version');
  }

  async showInfo(): Promise<{[key: string]: string}> {
    const res = await this.execute('show info');
    const splitRes = res.split('\n');
    return splitRes
      .reduce((obj, s) => {
        const [ key, val ] = s.split(/:\s+/);
        return {
          ...obj,
          [key.replace(/\s+/g, '_')]: val,
        };
      }, {});
  }

  async showStat(): Promise<{[key: string]: string}[]> {
    const res = await this.execute('show stat');
    const trimmed = res
      .replace(/^#\s+/, '')
      .split('\n')
      .map(s => s.replace(/,$/, ''))
      .join('\n');
    return new Promise((resolve, reject) => {
      parse(trimmed, {columns: true}, (err, records) => {
        if(err)
          reject(err);
        else
          resolve(records);
      });
    });
  }

  async setServer(state: "ready"|"drain"|"maint", backend: string, server: string): Promise<string> {
    return await this.execute(`set server ${backend}/${server} state ${state}`);
  }

  async showMap(mapPath?: string): Promise<string> {
    return await this.execute(`show map${mapPath ? ` ${mapPath}` : ''}`);
  }

  async clearMap(mapPath: string): Promise<string> {
    return await this.execute(`clear map ${mapPath}`);
  }

  async addMap(mapPath: string, host: string, backend: string): Promise<string> {
    return await this.execute(`add map ${mapPath} ${host} ${backend}`);
  }

  async setMap(mapPath: string, host: string, backend: string): Promise<string> {
    return await this.execute(`set map ${mapPath} ${host} ${backend}`);
  }

  async delMap(mapPath: string, host: string): Promise<string> {
    return await this.execute(`del map ${mapPath} ${host}`);
  }

  async getMap(mapPath: string, host: string): Promise<string> {
    return await this.execute(`get map ${mapPath} ${host}`);
  }

}
