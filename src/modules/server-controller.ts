import cloneDeep from 'lodash/cloneDeep';
import { Gateway, ChainHost } from '../interfaces';
import { HAP, RouteObj } from './hap';
import { Docker } from './docker';
import { httpLogPatt, timeout } from '../util';
import { Logger } from './logger';
import { ChildProcess, spawn } from 'child_process';
import { LocalConfig } from './local-config';
import { ApiClient } from './api-client';
import dayjs from 'dayjs';

export interface ServerData {
  name: string
  httpPort: number
  apiPort: number
  statsPort: number
  controlPort: number
  statsUser: string
  statsPass: string
}

export interface GeneralRelayCounts {
  start: number
  end: number
  relays: {[chainId: string]: number}
}

export class ServerController {

  _hap?: HAP;
  _localConfig: LocalConfig;
  _apiClient: ApiClient;
  // _servers: ServerData[];
  _docker: Docker;
  _logger: Logger;
  _instances: {[key: string]: ChildProcess} = {};
  _servers: ServerData[] = [];
  _gateway: Gateway;

  constructor(localConfig: LocalConfig, gateway: Gateway, apiClient: ApiClient, docker: Docker, logger: Logger) {
    this._localConfig = localConfig;
    this._gateway = gateway;
    this._apiClient = apiClient;
    // this._servers = servers;
    // this._dbUtils = dbUtils;
    this._docker = docker;
    this._logger = logger;
  }

  generateHttpServerHostName(idx: number) {
    return `gateway-http-server-${idx}`;
  }

  async initialize() {
    const gateway = this._gateway;
    const servers: ServerData[] = [];
    for(let i = 0; i < 2; i++) {
      servers.push({
        name: this.generateHttpServerHostName(i),
        httpPort: gateway.serverStartingHttpPort + i,
        apiPort: gateway.serverStartingApiPort + i,
        statsPort: gateway.serverStartingStatsPort + i,
        controlPort: gateway.serverStartingControlPort + i,
        statsUser: gateway.statsUser,
        statsPass: gateway.statsPass,
      });
    }
    this._servers = servers;
  }

  getServers(): ServerData[] {
    return cloneDeep(this._servers);
  }

  async startAll() {
    const servers = this._servers;
    for(let i = 0; i < servers.length; i++) {
      await this.spawnServer(i);
    }
  }

  spawnServer(serverIdx: number) {
    const { argv } = process;
    const [ binary ] = argv;
    const args = [
      argv[1],
      'server',
      'start',
    ];
    const idxStr = serverIdx.toString();
    let instance = spawn(binary, [...args, idxStr], {
      // detached: true,
    });
    // instance.stdout.on('data', (data) => {
    //   process.stdout.write(data);
    // });
    // instance.stderr.on('data', (data) => {
    //   process.stderr.write(data);
    // });
    instance.on('error', console.error);
    instance.on('close', (exitCode) => {
      // @ts-ignore
      instance = null;
      delete this._instances[idxStr];
    //   console.log('exitCode', exitCode);
    });
    this._instances[idxStr] = instance;
  }

  async generateRoutes(): Promise<RouteObj[]> {
    const { httpPort } = this._gateway;
    const gatewayHosts = await this._apiClient.getHosts();
    return gatewayHosts
      .map(({ id, hosts }) => {
        return hosts.map((host) => {
          return {
            host: `${host}${[80, 443].includes(httpPort) ? '' : `:${httpPort}`}`,
            backend: id,
          }
        })
      })
      .reduce((arr, hosts) => {
        return arr.concat(hosts);
      }, []);
  }

  _generalRelayCounts: GeneralRelayCounts = {start: 0, end: 0, relays: {}};
  _hostRelayCounts: {[host: string]: number[]} = {};

  async startHttpServer(idxStr: string) {
    const idx = Number(idxStr);
    // const config = this._config;
    // const dbUtils = this._dbUtils;
    const docker = this._docker;
    const logger = this._logger;
    // const rpcGateways = await dbUtils.getRpcGateways(config.awsLogRegion);
    const rpcEndpoints = await this._apiClient.getRpcEndpoints();
    const routes = await this.generateRoutes();
    const backends = rpcEndpoints
      .map((rpcEndpoint) => {
        const [ host, path ] = this.splitHostPath(rpcEndpoint.address);
        return {
          name: rpcEndpoint.chainId,
          servers: [
            {name: `${rpcEndpoint.chainId}-0`, host, port: rpcEndpoint.port, path}
          ]
        }
      });
    const server = this._servers[idx];
    let restartCount = 0;
    const hap = new HAP({
      dockerName: server.name,
      dockerCpus: this._localConfig.hapCpus,
      dockerMem: this._localConfig.hapMem,
      mode: 'http',
      port: server.httpPort,
      apiPort: server.apiPort,
      statsPort: server.statsPort,
      statsUser: server.statsUser,
      statsPass: server.statsPass,
      docker,
      routes,
      backends,
    });
    hap.on(HAP.events.INFO, (message: string) => {
      const splitMessage = message.split('\n');
      for(let i = 0; i < splitMessage.length; i++) {
        const str = splitMessage[i].trim();
        if(str) {
          logger.serverInfo(str);
          const matches = str.match(httpLogPatt);
          if(!matches)
            continue;
          let [ , sourceIp, timestamp, status, bytes, host ] = matches;
          if(/^5/.test(status))
            continue;
          host = host.split(':')[0];
          const chainId = host.split('.')[1];
          if(!chainId)
            continue;
          const now = dayjs().utc().valueOf();
          if(!this._generalRelayCounts.start)
            this._generalRelayCounts.start = now;
          this._generalRelayCounts.end = now;

          // Gateway stats
          if(this._generalRelayCounts.relays[chainId]) {
            this._generalRelayCounts.relays[chainId]++;
          } else {
            this._generalRelayCounts.relays[chainId] = 1;
          }

          // Host stats
          if(this._hostRelayCounts[host]) {
            this._hostRelayCounts[host].push(now);
          } else {
            this._hostRelayCounts[host] = [now];
          }

          // if(status !== '200')
          //   continue;
          // if(this.counts[host]) {
          //   this.counts[host].count++;
          // } else {
          //   this.counts[host] = {
          //     date: dayjs().format('YYYY-MM-DD'),
          //     count: 1,
          //   };
          // }
        }
      }
    });
    hap.on(HAP.events.NOTICE, (message: string) => {
      const splitMessage = message.split('\n');
      for(let i = 0; i < splitMessage.length; i++) {
        const str = splitMessage[i].trim();
        if(str) {
          logger.serverNotice(`HTTP_${idx}: ${str}`);
        }
      }
    });
    hap.on(HAP.events.ERROR, (err: Error) => {
      logger.gatewayError(err.message + '\n' + err.stack);
    });
    hap.on(HAP.events.CLOSE, (exitCode: number|null) => {
      logger.gatewayInfo(`HAProxy HTTP server ${idxStr} exited with code ${exitCode}`);
      if(exitCode !== 0) {
        restartCount++;
        logger.gatewayInfo(`Restarting HAProxy HTTP server ${idxStr} (count: ${restartCount})`);
        hap.start()
          .catch(err => {
            logger.gatewayError(err);
          });
      }
    });
    logger.gatewayInfo(`Starting HAProxy HTTP server ${idxStr}`);

    try {
      await hap.start();
    } catch(err: any) {
      logger.gatewayError(err.message + '\n' + err.stack);
      throw err;
    }

    this._hap = hap;
  }

  splitHostPath(hostPath: string): [string, string] {
    const [ host, ...pathArr ] = hostPath.split('/');
    const path = pathArr.join('/');
    return [host, path ? `/${path}` : ''];
  }

  async startTcpServer() {
    const logger = this._logger;
    // const { hostIp } = this._config;
    const gateway = this._gateway;
    const {
      apiPort,
      httpPort,
      statsPort,
      statsUser,
      statsPass,
    } = gateway;
    let restartCount = 0;
    const servers = this.getServers();
    const hap = new HAP({
      dockerName: `gateway-tcp-server`,
      dockerCpus: this._localConfig.hapCpus,
      dockerMem: this._localConfig.hapMem,
      mode: 'tcp',
      port: httpPort,
      apiPort,
      statsPort,
      statsUser,
      statsPass,
      docker: this._docker,
      routes: [],
      backends: [
        {
          name: 'http_back',
          servers: servers.map((server, i) => {
            return {
              name: server.name,
              host: this.generateHttpServerHostName(i),
              port: server.httpPort,
              path: '',
            };
          }),
        },
      ],
    });
    hap.on(HAP.events.INFO, (message: string) => {
      const splitMessage = message.split('\n');
      for(let i = 0; i < splitMessage.length; i++) {
        const str = splitMessage[i].trim();
        if(str) {
          logger.serverInfo(str);
        }
      }
    });
    hap.on(HAP.events.NOTICE, (message: string) => {
      const splitMessage = message.split('\n');
      for(let i = 0; i < splitMessage.length; i++) {
        const str = splitMessage[i].trim();
        if(str) {
          logger.serverNotice(`TCP: ${str}`);
        }
      }
    });
    hap.on(HAP.events.ERROR, (err: Error) => {
      logger.gatewayError(err.message + '\n' + err.stack);
    });
    hap.on(HAP.events.CLOSE, (exitCode: number|null) => {
      logger.gatewayInfo(`HAProxy TCP load balancer exited with code ${exitCode}`);
      if(exitCode !== 0) {
        restartCount++;
        logger.gatewayInfo(`Restarting HAProxy TCP load balancer (count: ${restartCount})`);
        hap.start()
          .catch(err => {
            logger.gatewayError(err);
          });
      }
    });
    logger.gatewayInfo(`Starting HAProxy TCP load balancer`);

    try {
      await hap.start();
    } catch(err: any) {
      logger.gatewayError(err.message + '\n' + err.stack);
      throw err;
    }

    this._hap = hap;
  }

  _rebuilding = false;
  _rebuildAfter = false;

  async rebuild(): Promise<void> {
    try {
      if(this._rebuilding) {
        this._rebuildAfter = true;
        return;
      }
      this._rebuilding = true;
      this._rebuildAfter = false;
      const routes = await this.generateRoutes();
      await this._hap?.setRoutes(routes);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
    }
    this._rebuilding = false;
    if(this._rebuildAfter)
      return await this.rebuild();
  }

  _restarting = false;
  _restartAfter = false;

  async restartAllServers(): Promise<void> {
    try {
      if(this._restarting) {
        this._restartAfter = true;
        return;
      }
      this._restarting = true;
      this._restartAfter = false;
      const servers = this.getServers();
      for(let i = 0; i < servers.length; i++) {
        const server = servers[i];
        await this._hap?.setServerState('drain', 'http_back', server.name);
        await timeout(60000);
        const idx = i.toString(10);
        this._instances[idx].removeAllListeners();
        await timeout(100);
        this._instances[idx].kill();
        delete this._instances[idx];
        await timeout(100);
        await this.spawnServer(i);
        await timeout(60000);
        if(i < servers.length - 1)
          await timeout(1000);
      }
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
    }
    this._restarting = false;
    if(this._restartAfter)
      return await this.restartAllServers();
  }

  async reloadHaproxy(): Promise<void> {
    try {
      if(this._rebuilding)
        return;
      await this._hap?.reload();
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
    }
  }

  async shutdownAllServers(): Promise<void> {
    try {
      const servers = this.getServers();
      await Promise.all(servers.map((s) => this._hap?.setServerState('drain', 'http_back', s.name)))
      await timeout(60000);
    } catch(err: any) {
      this._logger.gatewayError(err.message + '\n' + err.stack);
    }
    this._restarting = false;
    if(this._restartAfter)
      return await this.restartAllServers();
  }

  drainGeneralRelayCounts(): GeneralRelayCounts {
    const generalRelayCounts = this._generalRelayCounts;
    this._generalRelayCounts = {
      start: 0,
      end: 0,
      relays: {},
    };
    return generalRelayCounts;
  }

  drainHostRelayCounts(): {[host: string]: number[]} {
    const hostRelayCounts = this._hostRelayCounts;
    this._hostRelayCounts = {};
    return hostRelayCounts;
  }

}
