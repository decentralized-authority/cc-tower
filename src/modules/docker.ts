import { ChildProcess, execFile, spawn } from 'child_process';
import { EventEmitter } from 'events';

interface DockerPSItem {
  Command: string
  CreatedAt: string
  ID: string
  Image: string
  Labels: string
  LocalVolumes: string
  Mounts: string
  Names: string
  Networks: string
  Ports: string
  RunningFor: string
  Size: string
  State: string
  Status: string
}

interface DockerContainerInspectItem {
  Id: string
  Created: string
  Name: string
  RestartCount: number
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    Restrating: boolean
    Dead: boolean
    Pid: number
    ExitCode: number
    Error: string
    StartedAt: string
    FinishedAt: string
  }
}

export class Docker extends EventEmitter {

  static events = {
    ERROR: 'ERROR',
    INFO: 'INFO',
  }

  _execFile = execFile;

  _spawn = spawn;

  _objectPatt = /({.+})/;

  _logDriver = '';

  private _logError(err: Error): void {
    this.emit(Docker.events.ERROR, err);
  }

  private _logInfo(str: string): void {
    this.emit(Docker.events.INFO, str);
  }

  constructor(logDriver = 'none') {
    super();
    this._logDriver = logDriver;
  }

  public async listNetworks():Promise<{Name: string}[]> {
    try {
      let encodedOutput = '';
      await new Promise<void>((resolve, reject) => {
        let instance = spawn('docker', [
          'network',
          'ls',
          `--format='{{json .}}'`,
        ]);
        instance.on('error', err => {
          this._logError(err);
          reject(err);
        });
        instance.on('close', code => {
          // @ts-ignore
          instance = null;
          resolve();
        });
        instance.stderr.on('data', (data: Buffer) => {
          const str = data.toString();
          reject(new Error(str));
        });
        instance.stdout.on('data', (data: Buffer) => {
          const str = data.toString();
          encodedOutput += str + '\n';
        });
      });
      return encodedOutput
        .trim()
        .split('\n')
        .map(s => s.trim())
        .filter(s => s)
        .map((s): {Name: string} => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return JSON.parse(s.slice(1, s.length - 1));
          } catch (err) {
            return {Name: ''};
          }
        })
        .filter(data => data.Name);
    } catch(err: any) {
      this._logError(err);
      return [];
    }
  }

  public async createNetwork(networkName: string): Promise<boolean> {
      if(!networkName) {
      this._logError(new Error('networkName argument missing in createNetwork call'));
      return false;
    }
    const networks = await this.listNetworks();
    const found = networks.find(n => n.Name === networkName);
    if(found) return true;
    try {
      await new Promise<void>((resolve, reject) => {
        const command = 'docker';
        const args = [
          'network',
          'create',
          networkName,
        ];
        this.emit(Docker.events.INFO, `${command} ${args.join(' ')}`);
        let instance = spawn(command, args);
        instance.on('error', err => {
          reject(err);
        });
        instance.on('close', () => {
          // @ts-ignore
          instance = null;
          resolve();
        });
        instance.stderr.on('data', (data: Buffer) => {
          const str = data.toString();
          reject(new Error(str));
        });
        // instance.stdout.on('data', data => {
        //   const str = data.toString();
        // });
      });
    } catch(err: any) {
      this._logError(err);
      return false;
    }
    return true;
  }

  async containerExists(name: string): Promise<boolean> {
    try {
      const data = await this.containerInspect(name);
      return !!data;
    } catch(err) {
      return false;
    }
  }

  public async containerInspect(name: string): Promise<DockerContainerInspectItem|null> {
    try {
      const output: string = await new Promise((resolve, reject) => {
        this._execFile('docker', ['container', 'inspect', '--format', '"{{json .}}"', name], {}, (err, output) => {
          if (err)
            reject(err);
          else
            resolve(output.toString());
        });
      });
      const matches = output.match(this._objectPatt);
      const jsonStr = matches ? matches[1] : '{}';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return JSON.parse(jsonStr);
    } catch (err: any) {
      return null;
    }
  }

  public async containerStats(name: string): Promise<any> {
    try {
      const output: string = await new Promise((resolve, reject) => {
        this._execFile('docker', ['container', 'stats', '--no-stream', '--no-trunc', '--format', '"{{json .}}"', name], {}, (err, output) => {
          if (err)
            reject(err);
          else
            resolve(output.toString());
        });
      });
      const matches = output.match(this._objectPatt);
      const jsonStr = matches ? matches[1] : '{}';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return JSON.parse(jsonStr);
    } catch (err: any) {
      this._logError(err);
      return {};
    }
  }

  public ps(): Promise<DockerPSItem[]> {
    return new Promise(resolve => {
      execFile('docker', ['ps', '--format', '"{{json .}}"'], (err, output) => {
        if(err) {
          this._logError(err);
          resolve([]);
        }
        try {
          return output.toString()
            .split(/\n|\r/g)
            .map(s => s.trim())
            .filter(s => s)
            .map(s => s
              .replace(/^"/, '')
              .replace(/"$/, ''))
            .map(s => JSON.parse(s));
        } catch(err: any) {
          this._logError(err);
          resolve([]);
        }
      });
    });
  }

  public run(image: string, args: string[], onStdout?: (output: string) => void, onStderr?: (output: string) => void, onErr?: (err: Error) => void, onClose?: (statusCode: number) => void, silent = false): ChildProcess {
    const command = 'docker';
    args = [
      '--log-driver',
      this._logDriver,
      ...args,
    ];
    const splitImage = image.split(/\s+/);
    const runArgsStr = splitImage.slice(1).join(' ');
    const splitRunArgs = [''];
    let quotedStr = '';
    for(let i = 0; i < runArgsStr.length; i++) {
      const char = runArgsStr[i];
      const isQuote = /['"]/.test(char);
      if(quotedStr) {
        quotedStr += char;
        if(isQuote) {
          splitRunArgs.push(quotedStr);
          quotedStr = '';
        }
      } else if(isQuote) { // if it is an opening quote
        quotedStr += char;
      } else if(/\s/.test(char)) { // if it is white space
        splitRunArgs.push('');
      } else { // if it is not whitespace
        splitRunArgs[splitRunArgs.length - 1] += char;
      }
    }
    const spawnArgs = [
      'run',
      ...args,
      splitImage[0],
      ...splitRunArgs
        .filter(s => s),
    ];
    if(!silent)
      this.emit(Docker.events.INFO, `${command} ${spawnArgs.join(' ')}`);
    let instance = this._spawn(command, spawnArgs);
    instance.on('error', err => {
      this._logError(err);
      if(onErr)
        onErr(err);
    });
    instance.on('close', code => {
      // @ts-ignore
      instance = null;
      if(onClose)
        onClose(code || 0);
    });
    instance.stdout.on('data', (data: Buffer) => {
      if(onStdout && !silent)
        onStdout(data.toString());
    });
    instance.stderr.on('data', (data: Buffer) => {
      if(onStderr)
        onStderr(data.toString());
    });
    return instance;
  }

  public composeUp(configPath: string, args: string[], onOutput?: (output: string) => void, onErr?: (err: Error) => void, onClose?: (statusCode: number) => void, silent = false): ChildProcess {
    const command = 'docker-compose';
    const spawnArgs = [
      '-f',
      configPath,
      'up',
      ...args,
    ];
    if(!silent)
      this.emit(Docker.events.INFO, `${command} ${spawnArgs.join(' ')}`);
    let instance = this._spawn(command, spawnArgs);
    instance.on('error', err => {
      this._logError(err);
      if(onErr)
        onErr(err);
    });
    instance.on('close', code => {
      // @ts-ignore
      instance = null;
      if(onClose)
        onClose(code || 0);
    });
    instance.stdout.on('data', (data: Buffer) => {
      if(onOutput && !silent)
        onOutput(data.toString());
    });
    instance.stderr.on('data', (data: Buffer) => {
      if(onOutput)
        onOutput(data.toString());
    });
    return instance;
  }

  public exec(containerName: string, args: string[], command: string, onOutput: (output: string) => void, onErr: (err: Error) => void, onClose: (statusCode: number) => void, silent = false): ChildProcess {
    const spawnCommand = 'docker';
    const spawnArgs = [
      'exec',
      ...args,
      containerName,
      ...command
        .split(/\s/g)
        .map(s => s.trim())
        .filter(s => s),
    ];
    if(!silent)
      this.emit(Docker.events.INFO, `${spawnCommand} ${spawnArgs.join(' ')}`);
    let instance = this._spawn(spawnCommand, spawnArgs);
    instance.on('error', err => {
      this._logError(err);
      if(onErr)
        onErr(err);
    });
    instance.on('close', code => {
      // @ts-ignore
      instance = null;
      if(onClose)
        onClose(code || 0);
    });
    instance.stdout.on('data', (data: Buffer) => {
      if(onOutput)
        onOutput(data.toString());
    });
    instance.stderr.on('data', (data: Buffer) => {
      if(onOutput)
        onOutput(data.toString());
    });
    return instance;
  }

  public kill(name: string): Promise<string> {
    return new Promise(resolve => {
      const command = 'docker';
      const args = ['kill', name];
      this.emit(Docker.events.INFO, `${command} ${args.join(' ')}`);
      execFile(command, args, {}, (err, output) => {
        if(err) {
          this._logError(err);
          resolve('');
        } else {
          const outputStr = output.toString();
          resolve(outputStr);
        }
      });
    });
  }

  public stop(name: string, timeout: number): Promise<string> {
    return new Promise(resolve => {
      const command = 'docker';
      const args = ['stop', '-t', timeout.toString(10), name];
      this.emit(Docker.events.INFO, `${command} ${args.join(' ')}`);
      execFile(command, args, {}, (err, output) => {
        if(err) {
          this._logError(err);
          resolve('');
        } else {
          const outputStr = output.toString();
          resolve(outputStr);
        }
      });
    });
  }

  pull(image: string, onOutput?: (output: string)=>void): Promise<number> {
    return new Promise((resolve, reject) => {
      let instance = spawn('docker', ['pull', image]);
      instance.stdout.on('data', data => {
        const str = data.toString();
        if(onOutput)
          onOutput(str);
      });
      instance.stderr.on('data', data => {
        const str = data.toString();
        if(onOutput)
          onOutput(str);
      });
      instance.on('error', err => {
        reject(err);
      });
      instance.on('close', code => {
        // @ts-ignore
        instance = null;
        resolve(code || 0);
      });
    });
  }

  public rm(name: string, force = false): Promise<boolean> {
    return new Promise(resolve => {
      const command = 'docker';
      let args: string[];
      if(force)
        args = ['rm', '-f', name];
      else
        args = ['rm', name];
      this.emit(Docker.events.INFO, `${command} ${args.join(' ')}`);
      execFile(command, args, {}, err => {
        if(err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  public attach(name: string, onOutput?: (output: string) => void, onErr?: (err: Error) => void, onClose?: (statusCode: number) => void): ChildProcess {
    const command = 'docker';
    const spawnArgs = [
      'attach',
      // '--no-stdin',
      // '--sig-proxy=false',
      name,
    ];
    this.emit(Docker.events.INFO, `${command} ${spawnArgs.join(' ')}`);
    let instance = this._spawn(command, spawnArgs);
    instance.on('error', err => {
      this._logError(err);
      if(onErr)
        onErr(err);
    });
    instance.on('close', code => {
      // @ts-ignore
      instance = null;
      if(onClose)
        onClose(code || 0);
    });
    instance.stdout.on('data', (data: Buffer) => {
      if(onOutput)
        onOutput(data.toString());
    });
    instance.stderr.on('data', (data: Buffer) => {
      if(onOutput)
        onOutput(data.toString());
    });
    return instance;
  }

  async checkIfRunningAndRemoveIfPresentButNotRunning(name: string): Promise<boolean> {
    const containerData = await this.containerInspect(name);
    const running = containerData ? containerData.State.Running : false;
    if(containerData && !running) {
      await this.rm(name);
    }
    return running;
  }

}
