import os from 'os';
import * as uuid from 'uuid';
import path from 'path';
import fs from 'fs-extra';
import { Docker } from './docker';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { HapRuntimeApi } from './hap-runtime-api';
import cloneDeep from 'lodash/cloneDeep';
import { DOCKER_NETWORK, DOCKER_HOST } from '../constants';

export interface BackendServer {
  name: string,
  host: string,
  port: number
}
export interface RouteObj {
  host: string
  backend: string
}

const httpConfig = `
global
  stats socket ipv4@0.0.0.0:{{API_PORT}} level admin
  stats timeout 2m
#  log 127.0.0.1:514 local0
#  chroot /var/lib/haproxy
#  stats timeout 30s
#  user haproxy
#  group haproxy
#  daemon

defaults
  mode http
  log stderr format raw local0 notice
  log stdout format raw local0 info
  timeout connect 30s
  timeout client  30s
  timeout server  30s
  timeout check   4s
  option dontlognull # This is to stop the logs from being spammed with health checks

frontend stats
#  bind 0.0.0.0:{{STATS_PORT}} ssl crt /usr/local/etc/haproxy/combined.pem
  bind 0.0.0.0:{{STATS_PORT}}
  stats enable
  stats uri /
  stats refresh 10s
  stats auth {{STATS_USER}}:{{STATS_PASS}}
#  stats admin if TRUE

frontend front
  bind 0.0.0.0:{{PORT}}
  log-format "%[capture.req.hdr(0)] [%trg] %ft %b/%s %TR/%Tw/%Tc/%Tr/%Ta %CC %CS %tsc %ac/%fc/%bc/%sc/%rc %sq/%bq %ST %B {%[capture.req.hdr(1)]} %hs %{+Q}r"
#  http-request return status 200 if { path /health }
  capture request header x-forwarded-for len 15 # Captures the origin IP address
  http-request capture req.hdr(Host) len 100 # Captures the host domain
  use_backend %[req.hdr(host),lower,map(/usr/local/etc/haproxy/hosts.map)]

{{BACKENDS}}
`;
const tcpConfig = `
global
  stats socket ipv4@0.0.0.0:{{API_PORT}} level admin
  stats timeout 2m

defaults
#  mode tcp
  mode http
  log stderr format raw local0 notice
#  log-format "%ci:%cp [%t] %ft %b/%s %Tw/%Tc/%Tt %B %ts %ac/%fc/%bc/%sc/%rc %sq/%bq"
  log stdout format raw local0 info
  timeout connect 30s
  timeout client  30s
  timeout server  30s
  option forwardfor

frontend stats
  mode http
#  bind 0.0.0.0:{{STATS_PORT}} ssl crt /usr/local/etc/haproxy/combined.pem
  bind 0.0.0.0:{{STATS_PORT}}
  option dontlognull
  stats enable
  stats uri /
  stats refresh 10s
  stats auth {{STATS_USER}}:{{STATS_PASS}}
#  stats admin if TRUE

frontend http_front
  bind 0.0.0.0:{{PORT}}
  option httplog
  default_backend http_back

resolvers docker
  nameserver dns0 127.0.0.11:53

{{BACKENDS}}
`;

interface HAPData {
  mode: 'http'|'tcp'
  port: number
  apiPort: number
  statsPort: number
  statsUser: string
  statsPass: string
  tcpPort?: number
  docker: Docker
  dockerName: string
  dockerCpus: number
  dockerMem: number
  routes: RouteObj[]
  backends: {name: string, servers: BackendServer[]}[]
}
interface HAPHttpData extends HAPData {
  mode: 'http'
}

export class HAP extends EventEmitter {

  static hostsPath = '/usr/local/etc/haproxy/hosts.map';

  static events = {
    INFO: 'INFO',
    NOTICE: 'NOTICE',
    ERROR: 'ERROR',
    CLOSE: 'CLOSE',
  };

  _mode: 'http'|'tcp'
  _fs = fs;
  _tmpDir = os.tmpdir();
  _apiPort: number;
  _port: number;
  _statsPort: number;
  _statsUser: string;
  _statsPass: string;
  _docker: Docker;
  _instance?: ChildProcess;
  _dockerName = 'haproxy';
  _dockerCpus: number;
  _dockerMem: number;
  _routes: RouteObj[];
  _backends: {name: string, servers: BackendServer[]}[];

  api: HapRuntimeApi;

  private _logError(err: Error): void {
    this.emit(HAP.events.ERROR, err);
  }

  private _logInfo(str: string): void {
    this.emit(HAP.events.INFO, str);
  }

  private _logNotice(str: string): void {
    this.emit(HAP.events.NOTICE, str);
  }

  constructor(data: HAPHttpData|HAPData) {
    super();
    this._mode = data.mode;
    this._docker = data.docker;
    this._dockerName = data.dockerName || this._dockerName;
    this._dockerCpus = data.dockerCpus;
    this._dockerMem = data.dockerMem;
    this._apiPort = data.apiPort;
    this._statsPort = data.statsPort;
    this._statsUser = data.statsUser;
    this._statsPass = data.statsPass;
    this._port = data.port || 0;
    this.api = new HapRuntimeApi('127.0.0.1', data.apiPort);
    this._routes = data.routes;
    this._backends = data.backends
      .map((b) => {
        return {
          name: b.name,
          servers: b.servers,
        }
      });
  }

  generateConfig(): string {
    if(this._mode === 'http') {
      return httpConfig
        .replace(/{{API_PORT}}/, this._apiPort.toString(10))
        .replace(/{{STATS_PORT}}/g, this._statsPort.toString(10))
        .replace(/{{STATS_USER}}/, this._statsUser)
        .replace(/{{STATS_PASS}}/, this._statsPass)
        .replace(/{{PORT}}/, this._port.toString(10))
        .replace(/{{BACKENDS}}/, this._backends
          .map(({ name, servers }) => {
            const lines: string[] = [
              `backend ${name}`,
              // '  filter compression',
              // '  compression algo gzip',
              '  balance leastconn',
              ...servers.map(s => `  server ${s.name} ${s.host}:${s.port} resolve-opts allow-dup-ip resolve-prefer ipv4 check`),
            ];
            return lines.join('\n');
          })
          .join('\n\n'));
    } else { // mode === 'tcp'
      return tcpConfig
        .replace(/{{API_PORT}}/, this._apiPort.toString(10))
        .replace(/{{STATS_PORT}}/g, this._statsPort.toString(10))
        .replace(/{{STATS_USER}}/, this._statsUser)
        .replace(/{{STATS_PASS}}/, this._statsPass)
        .replace(/{{PORT}}/, this._port.toString(10))
        .replace(/{{BACKENDS}}/, this._backends
          .map(({ name, servers }) => {
            const lines: string[] = [
              `backend ${name}`,
              '  balance leastconn',
              // '  option httpchk',
              // '  http-check send meth GET uri /health',
              // '  http-check expect status 200',
              ...servers.map((s, i) => `  server ${s.name} ${s.host}:${s.port} resolvers docker check${/443/.test(s.port.toString()) ? ' check-ssl verify none' : ''}${servers.length > 1 && i === servers.length - 1 ? ' backup' : ''}`),
            ];
            return lines.join('\n');
          })
          .join('\n\n'));
    }
  }

  backends(): {name: string, servers: BackendServer[]}[] {
    return cloneDeep(this._backends);
  }

  async start(): Promise<void> {

    const dockerName = this._dockerName;

    const apiPort = this._apiPort;
    const statsPort = this._statsPort;
    const port = this._port;

    const configPath = path.join(this._tmpDir, `${uuid.v4()}.cfg`);
    const config = this.generateConfig();
    await this._fs.writeFile(configPath, config, 'utf8');

    const hostsPath = path.join(this._tmpDir, `${uuid.v4()}.map`);
    await this._fs.writeFile(
      hostsPath,
      this._routes.map((route) => `${route.host} ${route.backend}`).join('\n'),
      'utf8'
    );

    // console.log(config);

    let args: string[] = [
      '--rm', '-i', '--name', dockerName, '--user', 'root',
      '--cpus', this._dockerCpus.toString(10),
      '--memory', this._dockerMem.toString(10) + 'MB',
      '-v', `${configPath}:/usr/local/etc/haproxy/haproxy.cfg`,
      '-v', `${hostsPath}:${HAP.hostsPath}`,
      '--add-host', `${DOCKER_HOST}:host-gateway`,
      '-p', `${apiPort}:${apiPort}/tcp`,
      '-p', `${statsPort}:${statsPort}/tcp`,
      '-p', `${port}:${port}/tcp`,
      '--network', DOCKER_NETWORK,
    ];

    const running = await this._docker.checkIfRunningAndRemoveIfPresentButNotRunning(dockerName);
    if(!running) {
      console.log('not running!');
      this._instance = await this._docker.run(
        'haproxy:lts-bullseye',
        args,
        (output) => this._logInfo(output),
        (output) => this._logNotice(output),
        (err) => this._logError(err)
      );
    } else {
      console.log('running!');
      this._instance = this._docker.attach(
        dockerName,
        (output) => this._logInfo(output),
        (output) => this._logNotice(output.message),
      );
    }

    this._instance.on('close', (exitCode) => {
      // @ts-ignore
      this._instance = null;
      this.emit(HAP.events.CLOSE, exitCode);
    });

    await this.api.ready();

  }

  async stop(): Promise<void> {
    await this._docker.stop(this._dockerName, 30);
  }

  async clearRoutes(): Promise<void> {
    await this.api.clearMap(HAP.hostsPath);
  }

  async getRoutes(): Promise<RouteObj[]> {
    const res = await this.api.showMap(HAP.hostsPath);
    return res
      .split('\n')
      .map(s => s.trim())
      .filter(s => !!s)
      .map(s => {
        const splitRes = s.split(/\s+/g);
        return {
          host: splitRes[1],
          backend: splitRes[2],
        };
      });
  }

  async setRoutes(routes: RouteObj[]): Promise<void> {
    for(const route of routes) {
      const backend = this._backends.find(b => b.name === route.backend);
      if(!backend)
        throw new Error(`Backend ${route.backend} not found.`);
    }
    const prevRoutes = await this.getRoutes();
    const prevRoutesMap = new Map(prevRoutes.map(r => [r.host, r.backend]));
    const routesMap = new Map(routes.map(r => [r.host, r.backend]));
    for(const { host, backend } of prevRoutes) {
      if(!routesMap.has(host)) {
        await this.api.delMap(HAP.hostsPath, host);
      }
    }
    for(const { host, backend } of routes) {
      if(prevRoutesMap.has(host)) {
        const prevBackend = prevRoutesMap.get(host);
        const currentBackend = routesMap.get(host);
        if(prevBackend !== currentBackend) {
          await this.api.setMap(HAP.hostsPath, host, backend);
        }
      } else {
        await this.api.addMap(HAP.hostsPath, host, backend);
      }
    }
  }

  async addRoute(host: string, backendName: string): Promise<void> {
    const backend = this._backends.find(b => b.name === backendName);
    if(!backend)
      throw new Error(`Backend ${backendName} not found.`);
    await this.api.addMap(HAP.hostsPath, host, backendName);
  }

  async hasRoute(host: string): Promise<boolean> {
    const res = await this.api.getMap(HAP.hostsPath, host);
    return /found=yes/.test(res);
  }

  async setRoute(host: string, backendName: string): Promise<void> {
    const backend = this._backends.find(b => b.name === backendName);
    if(!backend)
      throw new Error(`Backend ${backendName} not found.`);
    const hasRoute = await this.hasRoute(host);
    if(hasRoute) {
      await this.api.setMap(HAP.hostsPath, host, backendName);
    } else {
      await this.addRoute(host, backendName);
    }
  }

  async deleteRoute(host: string): Promise<void> {
    const hasRoute = await this.hasRoute(host);
    if(hasRoute)
      await this.api.delMap(HAP.hostsPath, host);
  }

  async setServerState(state: "ready"|"drain"|"maint", backend: string, server: string): Promise<void> {
    await this.api.setServer(state, backend, server);
  }

  reload(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let instance = spawn('docker', ['kill', '--signal=HUP' , this._dockerName]);
      instance.on('error', (err) => {
        reject(err);
      });
      instance.on('close', (code) => {
        // @ts-ignore
        instance = null;
        if(code === 0) {
          resolve(true);
        } else {
          reject(new Error(`Failed to reload haproxy. Exit code: ${code}`));
        }
      });
    });
  }

}
